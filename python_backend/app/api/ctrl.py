"""
ctrl API router - multi-connection version.
All device-specific operations require an `address` parameter.
"""
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import asyncio
import time

from app.services.ctrl_ble_bridge import (
    ctrl_ble_bridge,
    availability as ctrl_availability,
    ACTION_GPIO_SET, ACTION_GPIO_TOGGLE, ACTION_DAC,
    ACTION_PWM, ACTION_PWM_TIMED, ACTION_SERVO,
    SIGNAL_GPIO, SIGNAL_ADC, SIGNAL_EOG, SIGNAL_EMG, SIGNAL_FOCUS,
    TRIGGER_EDGE, TRIGGER_THRESH, TRIGGER_LINEAR,
    ROLE_INPUT, ROLE_OUTPUT,
)

router = APIRouter()


# ==================== Models ====================

class ConnectRequest(BaseModel):
    address: str
    timeout: float = 10.0

class DisconnectRequest(BaseModel):
    address: str

class ActionRequest(BaseModel):
    address: str
    action_type: int
    pin: int
    param1: int = 0
    param2: int = 0

class RuleItem(BaseModel):
    signal_type: int = SIGNAL_GPIO
    source_channel: int = 0
    trigger_mode: int = TRIGGER_EDGE
    threshold_low: int = 0
    threshold_high: int = 4095
    action_type: int = ACTION_GPIO_SET
    target_pin: int = 2
    action_param1: int = 1
    action_param2: int = 0
    target_mac: str = "00:00:00:00:00:00"

class AlgoParams(BaseModel):
    eog_threshold_uv: float = 45.0
    eog_refractory_ms: int = 350
    eog_baseline_tau: float = 1.5
    emg_threshold_uv: float = 60.0
    emg_window_sec: float = 1.0
    emg_min_bin_fraction: float = 0.4
    focus_threshold: int = 70
    focus_metric: int = 0
    focus_fft_size: int = 128

class WriteRulesRequest(BaseModel):
    address: str
    rules: List[RuleItem]
    algo_params: Optional[AlgoParams] = None

class StandaloneRequest(BaseModel):
    address: str
    rules: List[RuleItem]
    algo_params: Optional[AlgoParams] = None

class ClearRulesRequest(BaseModel):
    address: str


# ==================== Scan ====================

@router.get("/scan")
async def scan_devices(timeout: float = 4.0):
    try:
        devices = await asyncio.to_thread(ctrl_ble_bridge.scan, timeout)
        ok, detail = ctrl_availability()
        return {"success": True, "devices": devices, "count": len(devices),
                "ble_available": ok, "availability_detail": detail}
    except Exception as e:
        raise HTTPException(500, detail=str(e))


# ==================== Connect / Disconnect ====================

@router.post("/connect")
async def connect_device(req: ConnectRequest):
    try:
        result = await asyncio.to_thread(ctrl_ble_bridge.connect, req.address, req.timeout)
        return {"success": True, "status": "connected", **result}
    except Exception as e:
        raise HTTPException(500, detail=str(e))

@router.post("/disconnect")
async def disconnect_device(req: DisconnectRequest):
    try:
        result = await asyncio.to_thread(ctrl_ble_bridge.disconnect, req.address)
        return {"success": True, "status": "disconnected", **result}
    except Exception as e:
        raise HTTPException(500, detail=str(e))

@router.post("/disconnect_all")
async def disconnect_all():
    try:
        await asyncio.to_thread(ctrl_ble_bridge.disconnect_all)
        return {"success": True}
    except Exception as e:
        raise HTTPException(500, detail=str(e))


# ==================== Status ====================

@router.get("/status")
async def get_status():
    return {"success": True, **ctrl_ble_bridge.snapshot()}


# ==================== Actions ====================

@router.post("/action")
async def send_action(req: ActionRequest):
    try:
        ok = await asyncio.to_thread(
            ctrl_ble_bridge.send_action,
            req.address, req.action_type, req.pin, req.param1, req.param2)
        return {"success": ok}
    except Exception as e:
        raise HTTPException(500, detail=str(e))


# ==================== Rules ====================

@router.post("/rules/write")
async def write_rules(req: WriteRulesRequest):
    try:
        rules_dicts = [r.dict() for r in req.rules]
        algo = req.algo_params.dict() if req.algo_params else None
        ok = await asyncio.to_thread(ctrl_ble_bridge.write_rules, req.address, rules_dicts, algo)
        return {"success": ok, "message": f"written {len(rules_dicts)} rules"}
    except Exception as e:
        raise HTTPException(500, detail=str(e))

@router.post("/rules/standalone")
async def trigger_standalone(req: StandaloneRequest):
    try:
        rules_dicts = [r.dict() for r in req.rules]
        algo = req.algo_params.dict() if req.algo_params else None
        ok = await asyncio.to_thread(ctrl_ble_bridge.trigger_standalone, req.address, rules_dicts, algo)
        return {"success": ok, "message": "standalone mode triggered"}
    except Exception as e:
        raise HTTPException(500, detail=str(e))

@router.post("/rules/clear")
async def clear_rules(req: ClearRulesRequest):
    try:
        ok = await asyncio.to_thread(ctrl_ble_bridge.clear_rules, req.address)
        return {"success": ok, "message": "rules cleared"}
    except Exception as e:
        raise HTTPException(500, detail=str(e))




# ==================== Pin Configuration ====================

class ConfigPinsRequest(BaseModel):
    address: str
    din_pins: List[int] = []
    adc_pins: List[int] = []

@router.post("/config/pins")
async def configure_pins(req: ConfigPinsRequest):
    """Push pin configuration to device via BLE CONFIG characteristic."""
    try:
        ok = await asyncio.to_thread(
            ctrl_ble_bridge.configure_pins, req.address, req.din_pins, req.adc_pins)
        return {"success": ok, "message": f"DIN={req.din_pins} ADC={req.adc_pins}"}
    except Exception as e:
        raise HTTPException(500, detail=str(e))


# ==================== Runtime Rule Engine ====================

class RuntimeRule(BaseModel):
    from_addr: str
    from_pin: int
    from_type: int = 1
    to_addr: str
    to_pin: int
    to_action: int = 1
    to_param1: Optional[int] = None
    to_param2: int = 0

class ApplyRulesRequest(BaseModel):
    rules: List[RuntimeRule]

class ApplyGraphRequest(BaseModel):
    logic_nodes: List[Dict[str, Any]] = []
    connections: List[Dict[str, str]] = []

@router.post("/rules/apply-graph")
async def apply_logic_graph(req: ApplyGraphRequest):
    """Activate logic block graph for real-time routing."""
    from app.services.logic_rule_engine import logic_rule_engine
    with ctrl_ble_bridge._lock:
        ctrl_ble_bridge._active_rules = []
    logic_rule_engine.load_graph({
        "logic_nodes": req.logic_nodes,
        "connections": req.connections,
    })
    return {
        "success": True,
        "message": f"逻辑图已激活: {len(req.logic_nodes)} 块, {len(req.connections)} 连接",
        "logic_blocks": len(req.logic_nodes),
        "connections": len(req.connections),
    }

@router.get("/rules/graph")
async def get_logic_graph():
    from app.services.logic_rule_engine import logic_rule_engine
    return {"success": True, **logic_rule_engine.snapshot()}


@router.post("/rules/apply")
async def apply_runtime_rules(req: ApplyRulesRequest):
    """Activate rules for real-time signal routing between devices."""
    rules_dicts = [r.dict() for r in req.rules]
    ctrl_ble_bridge.apply_runtime_rules(rules_dicts)
    return {"success": True, "message": f"{len(rules_dicts)} rules activated", "count": len(rules_dicts)}

@router.post("/rules/stop")
async def stop_runtime_rules():
    """Stop all real-time signal routing."""
    ctrl_ble_bridge.clear_runtime_rules()
    return {"success": True, "message": "routing stopped"}

@router.get("/rules/active")
async def get_active_rules():
    """Get currently active runtime rules."""
    rules = ctrl_ble_bridge.get_runtime_rules()
    return {"success": True, "rules": rules, "count": len(rules)}


# ==================== Signals ====================

@router.get("/signals")
async def get_signals(count: int = 50):
    return {"success": True, "signals": ctrl_ble_bridge.get_signals(count)}

@router.websocket("/signals/stream")
async def ws_signal_stream(websocket: WebSocket):
    await websocket.accept()
    queue: asyncio.Queue = asyncio.Queue(maxsize=100)
    event_loop = asyncio.get_running_loop()

    def enqueue_signal(sig):
        try:
            queue.put_nowait(dict(sig))
        except asyncio.QueueFull:
            pass
    def on_signal(sig):
        try:
            event_loop.call_soon_threadsafe(enqueue_signal, sig)
        except asyncio.QueueFull:
            pass
    ctrl_ble_bridge.add_signal_listener(on_signal)
    try:
        while True:
            try:
                sig = await asyncio.wait_for(queue.get(), timeout=2.0)
                await websocket.send_json({"type": "signal", **sig})
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "heartbeat", "ts": time.time()})
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        ctrl_ble_bridge.remove_signal_listener(on_signal)


# ==================== Constants ====================

@router.get("/constants")
async def get_constants():
    return {
        "success": True,
        "actions": {"GPIO_SET": ACTION_GPIO_SET, "GPIO_TOGGLE": ACTION_GPIO_TOGGLE,
                    "DAC": ACTION_DAC, "PWM": ACTION_PWM,
                    "PWM_TIMED": ACTION_PWM_TIMED, "SERVO": ACTION_SERVO},
        "signals": {"GPIO": SIGNAL_GPIO, "ADC": SIGNAL_ADC,
                    "EOG": SIGNAL_EOG, "EMG": SIGNAL_EMG, "FOCUS": SIGNAL_FOCUS},
        "triggers": {"EDGE": TRIGGER_EDGE, "THRESH": TRIGGER_THRESH, "LINEAR": TRIGGER_LINEAR},
        "roles": {"INPUT": ROLE_INPUT, "OUTPUT": ROLE_OUTPUT},
    }
