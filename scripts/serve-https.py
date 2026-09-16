"""
Server HTTPS lokal (self-signed) untuk uji kamera di HP/device lain.

Kenapa perlu HTTPS? Browser hanya mengizinkan getUserMedia (kamera) di
secure context: https:// atau http://localhost. Membuka lewat IP LAN
(mis. http://10.180.x.x:8080) akan MEMBLOKIR kamera.

Cara pakai:
    1. python scripts/serve-https.py
    2. Di laptop : https://localhost:8443/checkin/
    3. Di HP     : https://<IP-LAN>:8443/checkin/   (terima peringatan sertifikat)
"""
import http.server
import ssl
import socket
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 8443
CERT_DIR = ROOT / ".certs"
CERT = CERT_DIR / "dev.crt"
KEY = CERT_DIR / "dev.key"


def lan_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def make_cert() -> None:
    """Buat sertifikat self-signed (butuh openssl; kalau tidak ada, pakai pyOpenSSL)."""
    CERT_DIR.mkdir(exist_ok=True)
    ip = lan_ip()

    # Coba openssl (tersedia di Git for Windows)
    openssl = None
    for candidate in ("openssl", r"C:\Program Files\Git\usr\bin\openssl.exe"):
        try:
            subprocess.run([candidate, "version"], capture_output=True, check=True)
            openssl = candidate
            break
        except Exception:
            continue

    cfg = CERT_DIR / "openssl.cnf"
    cfg.write_text(
        "[req]\n"
        "distinguished_name=dn\n"
        "x509_extensions=v3\n"
        "prompt=no\n"
        "[dn]\n"
        "CN=localhost\n"
        "[v3]\n"
        "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:" + ip + "\n"
    )

    if openssl:
        subprocess.run(
            [openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes",
             "-keyout", str(KEY), "-out", str(CERT), "-days", "365",
             "-config", str(cfg)],
            check=True, capture_output=True,
        )
        print(f"[cert] dibuat dengan openssl (SAN: localhost, 127.0.0.1, {ip})")
        return

    # Fallback: cryptography
    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        import datetime
        import ipaddress

        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
        san = x509.SubjectAlternativeName([
            x509.DNSName("localhost"),
            x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
            x509.IPAddress(ipaddress.ip_address(ip)),
        ])
        now = datetime.datetime.utcnow()
        cert = (
            x509.CertificateBuilder()
            .subject_name(name).issuer_name(name)
            .public_key(key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now)
            .not_valid_after(now + datetime.timedelta(days=365))
            .add_extension(san, critical=False)
            .sign(key, hashes.SHA256())
        )
        KEY.write_bytes(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ))
        CERT.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        print(f"[cert] dibuat dengan cryptography (SAN: localhost, 127.0.0.1, {ip})")
        return
    except ImportError:
        pass

    print("ERROR: butuh openssl atau paket `cryptography`.", file=sys.stderr)
    print("Install: pip install cryptography", file=sys.stderr)
    sys.exit(1)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # Hindari cache saat pengembangan
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # senyap


def main() -> None:
    if not CERT.exists() or not KEY.exists():
        make_cert()

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=str(CERT), keyfile=str(KEY))

    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    ip = lan_ip()
    print("=" * 62)
    print("Server HTTPS lokal jalan. Buka salah satu:")
    print(f"  Laptop : https://localhost:{PORT}/checkin/")
    print(f"  HP/LAN : https://{ip}:{PORT}/checkin/")
    print()
    print("Browser akan memperingatkan sertifikat self-signed:")
    print("  Chrome/Edge : Advanced -> Proceed")
    print("  Safari/iOS  : Show Details -> visit this website")
    print("  Android     : Advanced -> Proceed")
    print()
    print("Setelah itu kamera boleh diakses (secure context).")
    print("Tekan Ctrl+C untuk berhenti.")
    print("=" * 62)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nBerhenti.")
        httpd.shutdown()


if __name__ == "__main__":
    main()
