#!/usr/bin/env python3
"""Public measurement client. Contains no hidden coefficients or world seed."""
import argparse
import json
import urllib.request
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['quick', 'full', 'calibrate', 'run', 'log'])
    parser.add_argument('--parameters', help='Sequence recipe as JSON with T,P,cat,t,w')
    parser.add_argument('--x', type=float)
    parser.add_argument('--y', type=float)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    config = json.loads(Path('experiment-endpoint.json').read_text())
    body = json.loads(args.parameters or '{}') if args.mode == 'run' else {'mode': args.mode, 'x': args.x, 'y': args.y}
    endpoint = config['endpoint'].replace('/experiment', '/log') if args.mode == 'log' else config['endpoint']
    request = urllib.request.Request(endpoint, data=None if args.mode == 'log' else json.dumps(body).encode(), headers={'content-type': 'application/json', 'authorization': 'Bearer ' + config['token']})
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))

if __name__ == '__main__':
    main()
