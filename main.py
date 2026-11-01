from fastapi import FastAPI, HTTPException
from fastapi.templating import Jinja2Templates
from starlette.requests import Request
from fastapi.staticfiles import StaticFiles

from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv
# записуємо =>
import os
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("DB_LINK")
SUPABASE_KEY = os.getenv("DB_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


app = FastAPI(redirect_slashes=False)

app.mount("/static", StaticFiles(directory="static"), name="static")

templates = Jinja2Templates(directory="templates")

tasks = [
    {
        "id": 1,
        "title": "Прочитати 10 сторінок книги",
        "deadline": "сьогодні",
        "completed": False
    },
    {
        "id": 2,
        "title": "Сходити на вечірку о 16:00",
        "deadline": "завтра",
        "completed": True
    }
]


class Task(BaseModel):
    title: str
    deadline: Optional[str] = None
    completed: bool = False


next_id = 3

# CRUD -> Create, Read, Update, Delete
# HTTP: GET | POST | PUT | DELETE


@app.get("/")
def getMainPage(request: Request):
    data = {"message": "Hello!"}

    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"data": data}
    )


@app.get("/check")
def getTasks():
    tasks = (
        supabase.table("tasks")
        .select("*")
        .execute()
    )
    print(tasks)
    return tasks


@app.post("/new")
def addTask(task: Task):
    global next_id

    new_task = {
        "id": next_id,
        **task.model_dump()
    }

    tasks.append(new_task)
    next_id += 1

    return new_task


@app.get("/show-tasks")
def tasksPage(request: Request):
    all_tasks = (
        supabase.table("tasks")
        .select("*")
        .execute()
    )
    print(all_tasks)
    return templates.TemplateResponse(
        request=request,
        name="tasks.html",
        context={"tasks": tasks}
    )

@app.delete("/item-delete/{task_id}")
def deleteTask(task_id: int):    
    for item in tasks:
        if item['id'] == task_id:
            tasks.remove(item)
            return {
                "message": "success",
                "task": item
            }
    raise HTTPException(
        status_code=404,
        detail="Task not found"
    )


# нотатки

class Note(BaseModel):
    title: str
    text: str = ""


notes = [
    {"id": 1, "title": "Першв нотатка", "text": "Привіт, це теси"}
]
next_note_id = 2

# номер ТЦК, встав свій
TCC_PHONE = "+38683635442"


@app.get("/notes")
def notesPage(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="notes.html",
        context={"notes": notes, "phone": TCC_PHONE}
    )


@app.get("/api/notes")
def getNotes(search: Optional[str] = None):
    if search:
        return [n for n in notes if search.lower() in n["title"].lower()]
    return notes


@app.get("/api/notes/{note_id}")
def getNote(note_id: int):
    for item in notes:
        if item["id"] == note_id:
            return item
    raise HTTPException(status_code=404, detail="Note not found")


@app.post("/api/notes", status_code=201)
def addNote(note: Note):
    global next_note_id

    new_note = {"id": next_note_id, **note.model_dump()}
    notes.append(new_note)
    next_note_id += 1

    return new_note


@app.put("/api/notes/{note_id}")
def updateNote(note_id: int, note: Note):
    for item in notes:
        if item["id"] == note_id:
            item["title"] = note.title
            item["text"] = note.text
            return item
    raise HTTPException(status_code=404, detail="Note not found")


@app.delete("/api/notes/{note_id}")
def deleteNote(note_id: int):
    for item in notes:
        if item["id"] == note_id:
            notes.remove(item)
            return {"message": "success", "note": item}
    raise HTTPException(status_code=404, detail="Note not found")


# нагадування, кольори, закріплення (див. note_extras.py)
from note_extras import setup_note_extras
setup_note_extras(app, notes)
