from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


CommandStatus = Literal["pending", "sent", "acked", "done", "failed"]


class SourceMeta(BaseModel):
    pushId: Optional[str] = None
    rawEvent: Optional[str] = None
    topic: Optional[str] = None
    clientId: Optional[str] = None


class UnifiedDeviceMessage(BaseModel):
    provider: str = Field(..., examples=["onenet"])
    deviceId: str
    logicalKey: str
    productId: str
    deviceName: str
    messageId: str
    timestamp: int
    type: str
    messageType: Optional[str] = "report"
    payload: Dict[str, Any] = Field(default_factory=dict)
    sourceMeta: SourceMeta = Field(default_factory=SourceMeta)


class LatestQueryRequest(BaseModel):
    logicalKey: str


class CommandListQueryRequest(BaseModel):
    logicalKey: str
    limit: int = Field(default=20, ge=1, le=100)


class CommandDetailQueryRequest(BaseModel):
    commandId: str


class CommandSendRequest(BaseModel):
    logicalKey: str
    provider: Optional[str] = None
    productId: Optional[str] = None
    deviceName: Optional[str] = None
    params: Dict[str, Any] = Field(default_factory=dict)
    requestId: Optional[str] = None


class RuntimeCommand(BaseModel):
    commandId: str
    logicalKey: str
    productId: Optional[str] = None
    deviceName: Optional[str] = None
    provider: str
    commandName: str = "set_property"
    status: CommandStatus
    requestedAt: int
    sentAt: Optional[int] = None
    ackedAt: Optional[int] = None
    doneAt: Optional[int] = None
    failedAt: Optional[int] = None
    sentParams: Dict[str, Any] = Field(default_factory=dict)
    latestSnapshot: Dict[str, Any] = Field(default_factory=dict)
    errorMessage: str = ""


class CommandListResponse(BaseModel):
    success: bool = True
    logicalKey: str
    commands: List[RuntimeCommand] = Field(default_factory=list)
    cacheMeta: Dict[str, Any] = Field(default_factory=dict)


class CommandDetailResponse(BaseModel):
    success: bool = True
    command: Optional[RuntimeCommand] = None
    cacheMeta: Dict[str, Any] = Field(default_factory=dict)


class LatestDeviceResponse(BaseModel):
    success: bool = True
    logicalKey: str
    provider: str
    productId: Optional[str] = None
    deviceName: Optional[str] = None
    online: bool
    offline: bool
    onlineStatus: str
    lastSeenAt: Optional[int] = None
    offlineSinceMs: Optional[int] = None
    updatedAt: Optional[int] = None
    params: Dict[str, Any] = Field(default_factory=dict)
    latestCommand: Dict[str, Any] = Field(default_factory=dict)
    sensorSnapshot: Dict[str, Any] = Field(default_factory=dict)
    controlSnapshot: Dict[str, Any] = Field(default_factory=dict)
    plantSnapshot: Dict[str, Any] = Field(default_factory=dict)
    displaySnapshot: Dict[str, Any] = Field(default_factory=dict)
    cacheMeta: Dict[str, Any] = Field(default_factory=dict)


class CommandSendResponse(BaseModel):
    success: bool
    commandId: str
    commandStatus: CommandStatus
    provider: str
    logicalKey: str
    productId: Optional[str] = None
    deviceName: Optional[str] = None
    sentParams: Dict[str, Any] = Field(default_factory=dict)
    msg: Optional[str] = None


class IngestResponse(BaseModel):
    success: bool = True
    deduplicated: bool = False
    logicalKey: str
    messageId: str
    recordCount: int = 0
    reconciledCommands: List[Dict[str, Any]] = Field(default_factory=list)
