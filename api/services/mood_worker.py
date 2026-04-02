"""
Runs mood analysis in an isolated process so ML model memory is freed on exit.
Called by download_worker.py via subprocess; prints JSON result to stdout.
"""
import json
import sys


def main():
    if len(sys.argv) != 2:
        sys.exit(1)

    file_path = sys.argv[1]
    try:
        from mood_detector import analyze_audio
        result = analyze_audio(file_path)
        if hasattr(result, "__dict__"):
            print(json.dumps(vars(result)))
        elif isinstance(result, dict):
            print(json.dumps(result))
        else:
            sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
