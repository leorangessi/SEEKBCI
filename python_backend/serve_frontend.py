"""
简单的HTTP服务器，用于提供前端页面
解决 file:// 协议的 CORS 问题
"""
import http.server
import socketserver
import os

# 切换到前端目录
frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'web_frontend')
os.chdir(frontend_dir)

PORT = 8080

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # 开发时避免浏览器长期缓存 HTML/JS/CSS，否则本地改过脚本仍用旧文件（表现为「改动不生效」）
        path = self.path.split("?", 1)[0].split("#", 1)[0]
        if path.endswith((".html", ".js", ".css", ".json")):
            self.send_header("Cache-Control", "no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
        # 添加 CORS 头
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

Handler = MyHTTPRequestHandler

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print("=" * 60)
    print("  前端服务器启动成功！")
    print("=" * 60)
    print(f"\n📡 前端地址: http://localhost:{PORT}")
    print(f"🏠 主页: http://localhost:{PORT}/index.html")
    print(f"🔌 设备管理: http://localhost:{PORT}/device-manager.html")
    print(f"🧪 SSVEP测试: http://localhost:{PORT}/ssvep-test.html")
    print(f"\n按 Ctrl+C 停止服务")
    print("=" * 60)
    print()
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n\n服务器已停止")
