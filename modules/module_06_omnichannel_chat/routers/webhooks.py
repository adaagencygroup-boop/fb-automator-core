from fastapi import APIRouter, Query, Response, HTTPException, status, WebSocket, WebSocketDisconnect
from modules.module_06_omnichannel_chat.config import settings
from modules.module_06_omnichannel_chat.websocket import manager
from modules.module_06_omnichannel_chat.queue_worker import event_queue
import json

router = APIRouter(prefix="/api/facebook", tags=["Webhooks & Realtime"])

@router.websocket("/ws/{facebook_user_id}")
async def websocket_endpoint(websocket: WebSocket, facebook_user_id: str):
    await manager.connect(facebook_user_id, websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except Exception:
                pass
    except WebSocketDisconnect:
        manager.disconnect(facebook_user_id, websocket)
    except Exception as e:
        print(f"[WebSocket Endpoint Exception] {str(e)}")
        manager.disconnect(facebook_user_id, websocket)

@router.get("/webhook")
def verify_webhook(
    mode: str = Query(None, alias="hub.mode"),
    token: str = Query(None, alias="hub.verify_token"),
    challenge: str = Query(None, alias="hub.challenge")
):
    if mode == "subscribe" and token == settings.FACEBOOK_WEBHOOK_VERIFY_TOKEN:
        print(f"[Webhook] Verification successful. Challenge: {challenge}")
        return Response(content=challenge, media_type="text/plain")

    print("[Webhook] Verification failed. Token mismatch.")
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Verification token mismatch or invalid mode"
    )

@router.post("/webhook")
async def receive_webhook_event(payload: dict):
    if payload.get("object") == "page":
        await event_queue.put(payload)
        return Response(content="EVENT_RECEIVED", status_code=200)

    raise HTTPException(status_code=404, detail="Unknown event subscription object")


@router.api_route("/sync-webhook", methods=["GET", "POST"])
def manual_sync_webhook():
    from modules.module_06_omnichannel_chat.services.sync_service import sync_app_webhook
    return sync_app_webhook(force=True)

