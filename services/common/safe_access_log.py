"""Strip OAuth query parameters before ASGI servers emit response access logs."""
class OAuthQueryRedaction:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        async def safe_send(message):
            if message["type"] == "http.response.start" and "/api/auth/oauth/" in scope.get("path", ""):
                scope["query_string"] = b""
            await send(message)
        await self.app(scope, receive, safe_send)
