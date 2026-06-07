import multiprocessing

# ── Binding ───────────────────────────────────────────────────────────────────
# Only listen on localhost — Nginx is the public-facing entry point.
bind = "127.0.0.1:5000"

# ── Workers ───────────────────────────────────────────────────────────────────
workers = 4
worker_class = "sync"

# Generous timeout for face detection/clustering operations which can be slow.
timeout = 120

# Recycle workers periodically to guard against memory leaks in face_recognition.
max_requests = 500
max_requests_jitter = 50

# ── Logging ───────────────────────────────────────────────────────────────────
accesslog = "/var/log/gunicorn/photoapp-access.log"
errorlog  = "/var/log/gunicorn/photoapp-error.log"
loglevel  = "info"
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)sµs'

# ── Process naming ────────────────────────────────────────────────────────────
proc_name = "photoapp"

# ── Performance ───────────────────────────────────────────────────────────────
# Keep connections open briefly; pairs well with Nginx keepalive.
keepalive = 5
