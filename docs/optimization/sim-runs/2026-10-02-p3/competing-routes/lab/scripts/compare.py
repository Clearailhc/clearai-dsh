import os

c = os.path.getsize("lab/compact/data.json")
p = os.path.getsize("lab/pretty/data.json")
assert c == int(open("lab/compact/size.txt").read()) and p == int(open("lab/pretty/size.txt").read())
winner = "compact" if c < p else "pretty"
with open("lab/winner.txt", "w", encoding="utf-8") as f:
    f.write(f"{winner}\ncompact={c} pretty={p}\n")
print(winner, c, p)
