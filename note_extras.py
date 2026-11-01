"""
note_extras.py — нагадування, кольори та закріплення для нотаток.

Підключається двома рядками в кінці main.py. Існуючі ендпоінти не змінюються:
додаткові поля (remind_at, remind_done, color, pinned) лежать прямо в словнику
нотатки, тому вони зникають разом із нотаткою, а PUT /api/notes/{id} їх не чіпає.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

ALLOWED_COLORS = {"yellow", "pink", "mint", "blue"}


class NoteMeta(BaseModel):
    # мс від епохи (UTC). null — прибрати нагадування
    remind_at: Optional[int] = None
    remind_done: Optional[bool] = None
    # "yellow" | "pink" | "mint" | "blue"; null або "" — без кольору
    color: Optional[str] = None
    pinned: Optional[bool] = None


def setup_note_extras(app, notes):
    router = APIRouter()

    def find(note_id: int):
        for item in notes:
            if item["id"] == note_id:
                return item
        raise HTTPException(status_code=404, detail="Note not found")

    @router.put("/api/notes/{note_id}/meta")
    def updateNoteMeta(note_id: int, meta: NoteMeta):
        note = find(note_id)
        data = meta.model_dump(exclude_unset=True)

        if "remind_at" in data:
            if data["remind_at"] is None:
                note.pop("remind_at", None)
                note.pop("remind_done", None)
            else:
                if data["remind_at"] < 0:
                    raise HTTPException(status_code=400, detail="Bad remind_at")
                note["remind_at"] = data["remind_at"]
                # нове нагадування завжди «не виконане», якщо не сказано інше
                note["remind_done"] = bool(data.get("remind_done", False))
        elif "remind_done" in data and "remind_at" in note:
            note["remind_done"] = bool(data["remind_done"])

        if "color" in data:
            color = data["color"] or ""
            if color and color not in ALLOWED_COLORS:
                raise HTTPException(status_code=400, detail="Unknown color")
            if color:
                note["color"] = color
            else:
                note.pop("color", None)

        if "pinned" in data:
            if data["pinned"]:
                note["pinned"] = True
            else:
                note.pop("pinned", None)

        return note

    @router.get("/api/reminders")
    def getReminders():
        """Усі нагадування, що чекають: найближчі першими."""
        items = [
            {"id": n["id"], "title": n["title"], "remind_at": n["remind_at"]}
            for n in notes
            if n.get("remind_at") and not n.get("remind_done")
        ]
        return sorted(items, key=lambda x: x["remind_at"])

    app.include_router(router)
