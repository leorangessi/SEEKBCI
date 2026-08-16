import sys
sys.stdout.reconfigure(encoding='utf-8')
filepath = r'd:\Projects\SSVEP_PLAT\web_frontend\js\physical-world-ctrl.js'
with open(filepath, 'r', encoding='utf-8') as f:
    c = f.read()
i = c.find('function updatePinout')
j = c.find('\n}', i + 20)
print(c[i:j+2])
