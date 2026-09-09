import os, pty, subprocess, select, time, termios, fcntl, struct, json
import pyte, codecs, argparse
from pathlib import Path

parser = argparse.ArgumentParser(description="Read-only PTY smoke test for the workflow monitor")
parser.add_argument("--run", required=True)
parser.add_argument("--store")
args = parser.parse_args()
command = ["node", str(Path(__file__).resolve().parents[1] / "bin/dynamicwf.mjs"), "watch", "--run", args.run]
if args.store: command += ["--store", args.store]
master, slave = pty.openpty()
before = termios.tcgetattr(slave)
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 20, 80, 0, 0))
child = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave)
screen = pyte.Screen(80,20); stream = pyte.Stream(screen); raw=b''; decoder=codecs.getincrementaldecoder('utf-8')()
def pump(seconds):
    global raw
    until=time.monotonic()+seconds
    while time.monotonic()<until:
        if select.select([master],[],[],0.05)[0]:
            data=os.read(master,65536); raw+=data; stream.feed(decoder.decode(data))
def capture(name):
    text='\n'.join(screen.display)
    return text
try:
    pump(2)
    overview=capture('overview')
    assert 'DYNAMICWF' in overview and 'СЕЙЧАС' in overview and 'Ctrl+C' in overview, overview
    os.write(master,b'2');pump(0.5)
    history=capture('history'); assert 'новые сверху' in history, history
    os.write(master,b'4');pump(0.5)
    tokens=capture('tokens'); assert 'Токены:' in tokens and 'ПО МОДЕЛЯМ' in tokens, tokens
    os.write(master,b'3');pump(0.5)
    graph=capture('graph'); assert 'Graph ' in graph, graph
    os.write(master,b'\x1b[6~');pump(0.5)
    assert capture('scrolled')!=graph
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 16, 60, 0, 0))
    screen.resize(16,60)
    child.send_signal(__import__('signal').SIGWINCH)
    os.write(master,b'1');pump(1)
    narrow=capture('narrow'); assert 'DYNAMICWF' in narrow and 'Ctrl+C' in narrow, narrow
    os.write(master,b'q');pump(0.5);child.wait(timeout=3)
    assert child.returncode==0
    assert b'\x1b[?1049h' in raw and b'\x1b[?1049l' in raw and b'\x1b[?25h' in raw
    assert termios.tcgetattr(slave)==before, 'terminal mode not restored'
    print('PTY verified: overview, history, graph, tokens, scrolling, resize 80x20 to 60x16, q exit, cursor and terminal input restoration.')
    assert raw.index(b'DeprecationWarning') < raw.index(b'\x1b[?1049h') if b'DeprecationWarning' in raw else True
    print(overview)
finally:
    if child.poll() is None: child.kill();child.wait()
    os.close(master);os.close(slave)
