"""Convert a successful browser recording to a 60-second H.264 MP4."""
from pathlib import Path
import json, subprocess, re, shutil
import imageio_ffmpeg

root = Path(__file__).resolve().parents[1]
report = json.loads((root / '.recordings/recording-report.json').read_text('utf-8'))
if report['errors'] or len(report['steps']) != 10:
    raise SystemExit('Only a complete, successful recording may be exported')
source = Path(report['videoPath'])
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
probe = subprocess.run([ffmpeg, '-hide_banner', '-i', str(source)], capture_output=True, text=True)
match = re.search(r'Duration: (\d+):(\d+):([\d.]+)', probe.stderr)
if not match: raise SystemExit('Unable to read input duration')
hours, minutes, seconds = map(float, match.groups())
duration = hours*3600 + minutes*60 + seconds
offset = max(0, duration - report['recordedTailSeconds'])
media = root / 'docs/media'
media.mkdir(parents=True, exist_ok=True)
dest = media / 'clubhub-demo-60s.mp4'
subprocess.run([ffmpeg, '-y', '-hide_banner', '-loglevel', 'error', '-ss', str(offset), '-i', str(source), '-vf', 'setpts=PTS-STARTPTS,fps=25,format=yuv420p,tpad=stop_mode=clone:stop_duration=1', '-frames:v', '1500', '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-an', '-movflags', '+faststart', str(dest)], check=True)
for name in ['cover','registration','recruitment','review','stats']:
    shutil.copy2(root / f'.recordings/{name}.png', media / f'{name}.png')
check = subprocess.run([ffmpeg, '-hide_banner', '-i', str(dest)], capture_output=True, text=True)
assert '00:01:00.00' in check.stderr, check.stderr
assert '1920x1080' in check.stderr, check.stderr
assert 'h264' in check.stderr, check.stderr
print(json.dumps({'file':str(dest), 'bytes':dest.stat().st_size, 'duration_seconds':60, 'resolution':'1920x1080', 'fps':25, 'codec':'H.264', 'input_offset_seconds':round(offset,3)}, ensure_ascii=False))
