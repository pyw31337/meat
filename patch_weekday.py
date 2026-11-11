import pathlib
p = pathlib.Path('index.html')
c = p.read_text(encoding='utf-8')
old = '''function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return yy + '.' + mm + '.' + dd;
}'''
new = '''const WEEKDAYS = ['\uc77c','\uc6d4','\ud654','\uc218','\ubaa9','\uae08','\ud1a0'];
function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return yy + '.' + mm + '.' + dd + '(' + WEEKDAYS[d.getDay()] + ')';
}'''
if old in c:
    c = c.replace(old, new)
    print('patched')
else:
    print('not found')
p.write_text(c, encoding='utf-8')
