"""Run operational drills against isolated local PostgreSQL databases; never loads .env."""
import os, socket, subprocess, tempfile
from pathlib import Path
root = Path(tempfile.mkdtemp(prefix='pixup-ops-pg-'))
bin_dir = Path(os.environ.get('PIXUP_PG_BIN', '/opt/homebrew/opt/postgresql@18/bin'))
with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
def run(args, env=None):
    subprocess.run(args, check=True, env=env)
started = False
try:
    run([str(bin_dir/'initdb'), '-D', str(root/'data'), '-A', 'trust', '--no-locale'])
    run([str(bin_dir/'pg_ctl'), '-D', str(root/'data'), '-l', str(root/'server.log'), '-o', f'-h 127.0.0.1 -p {port} -k {root}', '-w', 'start'])
    started = True
    env = dict(os.environ, PGHOST='127.0.0.1', PGPORT=str(port), PGUSER=os.environ['USER'])
    for name in ('source_drill', 'restore_drill'):
        run([str(bin_dir/'createdb'), name], env)
    env['PIXUP_VERIFY_DATABASE_URL'] = f'postgres://{os.environ["USER"]}@127.0.0.1:{port}/source_drill'
    env['PIXUP_VERIFY_RESTORE_URL'] = f'postgres://{os.environ["USER"]}@127.0.0.1:{port}/restore_drill'
    run(['npm', 'run', 'ops:verify'], env)
finally:
    if started:
        run([str(bin_dir/'pg_ctl'), '-D', str(root/'data'), '-m', 'fast', '-w', 'stop'])
    print('Disposable PostgreSQL stopped. Application databases were not opened.')
