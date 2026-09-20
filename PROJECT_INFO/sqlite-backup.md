# Online backup SQLite в WAL-режиме

Это ручная процедура снимка журнала, не продуктовый backup/restore сервис.
Нужен Node.js >= 22.19.0 с `node:sqlite.backup`. Копирование одного `.sqlite`
при активном WAL может дать целостную, но устаревшую БД: последние committed
строки находятся в `-wal`. Последовательное копирование `.sqlite`, `-wal` и
`-shm` во время записи также не гарантирует согласованный снимок.

## Создание и проверка снимка

Не открывайте источник через `RunController`, `WorkflowService` или
`openWorkflowDatabase`: они не являются read-only просмотрщиками и могут
выполнять setup/recovery. Не вызывайте schema setup, checkpoint или смену
journal_mode на живом источнике ради backup. Используйте существующий файл
и прямое read-only соединение. Нужен доступ SQLite к WAL и его служебным
файлам; при ошибке доступа остановитесь, не удаляйте их и не обходите ошибку
копированием одного файла.

Пример самостоятельного `backup.mjs` (не импортирует приложение). Задайте
абсолютный путь существующего источника и каталог для **нового** снимка.
`mkdtemp` создаёт отдельный приватный каталог, поэтому destination не заменит
существующий журнал. Не используйте путь рабочего журнала как destination.

```js
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const sourcePath = '/absolute/path/to/existing/journal.sqlite';
const backupRoot = '/absolute/path/to/backups'; // существующий каталог
assert.ok((await stat(sourcePath)).isFile());
const directory = await mkdtemp(join(backupRoot, 'snapshot-'));
const destination = join(directory, 'journal.sqlite');
const source = new DatabaseSync(sourcePath, { readOnly: true });
try {
  await backup(source, destination); // настоящий async API; дождаться Promise
} finally {
  source.close();
}
// backup сам управляет соединением назначения. Проверяем только копию.
const copy = new DatabaseSync(destination, { readOnly: true });
try {
  assert.deepEqual(
    copy.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check),
    ['ok'],
  );
  // Замените SQL и ожидания на известные committed строки вашего журнала.
  // Пример для fixture из regression test, НЕ схема рабочего приложения:
  const ids = copy.prepare('SELECT id FROM backup_probe ORDER BY id')
    .all().map(row => row.id);
  assert.deepEqual(ids, ['baseline', 'post-checkpoint']);
} finally {
  copy.close();
}
console.log(destination);
```

Перед применением адаптируйте проверку ожидаемых строк к реальной схеме и
известным идентификаторам: `integrity_check=ok` сам по себе не доказывает
полноту данных. При продолжающейся записи не ожидайте, что снимок включает
все изменения вплоть до момента последующей проверки. При rejection backup
не считайте частичный destination пригодным: сохраните ошибку, повторяйте
только с новым destination. Не используйте управляющий UI для read-only
просмотра живого журнала или его копии: открытие через контроллер может
запустить recovery и изменить состояние.

## Ограничения restore

Restore рассматривается только в отдельном изолированном окружении, без
автоматического resume и запуска восстановленных процессов. Не подменяйте
живой журнал снимком. Сначала проверяйте копию напрямую read-only, затем
отдельно согласуйте план восстановления и побочные эффекты. Эта инструкция
не разрешает запуск контроллера над восстановленным журналом.

Журнал не включает sessions, skills/resources, cwd/worktrees, прочие внешние
файлы и внешние эффекты (например, уже отправленные запросы или изменения
репозитория). Их согласованное сохранение — отдельная задача. PID/owner из
снимка не доказывают живость или идентичность процессов: PID может быть
переиспользован. Снимок SQLite не является доказательством безопасного
повторного выполнения задач и не восстанавливает процессы.

## Offline regression

```sh
node --import tsx --test tests/sqlite-backup.test.ts tests/sqlite.test.ts
npm run typecheck
```

Тест использует только временную БД через `openWorkflowDatabase`, отключает
auto-checkpoint, выполняет checkpoint, затем добавляет строку при открытом
WAL. Single-file copy теряет эту строку, хотя проходит integrity_check;
online backup сохраняет её. Обе копии проверяются через readOnly, включая
отказ записи. Живые журналы и провайдеры не затрагиваются.

`src/sqlite.ts` и управление recovery остаются без изменений: новая
подсистема backup/restore не добавляется.
