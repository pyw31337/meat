import pathlib
p = pathlib.Path('index.html')
c = p.read_text(encoding='utf-8')
old = "https://www.megamart.com/search?query="
new = "https://www.megamart.com/search/?text="
if old in c:
    c = c.replace(old, new)
    print('patched')
else:
    print('not found')
p.write_text(c, encoding='utf-8')
