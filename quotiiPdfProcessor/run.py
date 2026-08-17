import os

import uvicorn

if __name__ == "__main__":
    app_env = (os.getenv("APP_ENV") or "development").lower()
    reload = app_env not in ("production", "prod", "test", "ci")
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=reload)
