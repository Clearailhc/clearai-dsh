"""Compare the two size readings and write lab/winner.txt."""

with open("lab/compact/size.txt", encoding="utf-8") as f:
    compact = int(f.read().strip())
with open("lab/pretty/size.txt", encoding="utf-8") as f:
    pretty = int(f.read().strip())

if compact == pretty:
    winner = "tie"
else:
    winner = "compact" if compact < pretty else "pretty"
with open("lab/winner.txt", "w", encoding="utf-8") as f:
    f.write(f"{winner}\ncompact={compact} bytes, pretty={pretty} bytes\n")
print(winner, compact, pretty)
