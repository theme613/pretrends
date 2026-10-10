import urllib.request
import urllib.error
import json

BASE_URL = "http://localhost:3000"

def test_endpoint(path, method="GET", data=None):
    url = BASE_URL + path
    try:
        req = urllib.request.Request(url, method=method)
        if data:
            req.add_header('Content-Type', 'application/json')
            req.data = json.dumps(data).encode('utf-8')
        
        response = urllib.request.urlopen(req)
        status = response.getcode()
        body = response.read().decode('utf-8')
        print(f"[{method}] {path} -> {status}")
        try:
            print("Response:", json.dumps(json.loads(body), indent=2)[:300] + "...\n")
        except:
            print("Response:", body[:300] + "...\n")
    except urllib.error.URLError as e:
        print(f"[{method}] {path} -> Error: {e}")

if __name__ == "__main__":
    print("Running Smoke Tests...\n")
    test_endpoint("/api/health")
    test_endpoint("/api/categories")
    test_endpoint("/api/trends")
    test_endpoint("/api/scan", method="POST")
