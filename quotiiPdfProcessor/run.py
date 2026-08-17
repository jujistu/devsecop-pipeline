import os

import uvicorn

if __name__ == "__main__":
    app_env = (os.getenv("APP_ENV") or "development").lower()
    reload = app_env not in ("production", "prod", "test", "ci")
    host = os.getenv("HOST", "0.0.0.0")  # nosec B104 - intentional: container networking requires binding all interfaces
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("app:app", host=host, port=port, reload=reload)
