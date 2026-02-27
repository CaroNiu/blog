from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    func,
    select,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker


DATABASE_URL = "sqlite:///./blog.db"
SECRET_KEY = "change-this-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_SECONDS = 7200

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


class Base(DeclarativeBase):
    pass


class UserRole(str, Enum):
    ROLE_USER = "ROLE_USER"
    ROLE_ADMIN = "ROLE_ADMIN"


class UserStatus(str, Enum):
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"


class ArticleStatus(str, Enum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    DELETED = "DELETED"


class CommentStatus(str, Enum):
    NORMAL = "NORMAL"
    DELETED = "DELETED"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole), default=UserRole.ROLE_USER)
    status: Mapped[UserStatus] = mapped_column(SAEnum(UserStatus), default=UserStatus.ACTIVE)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    description: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True)


class ArticleTag(Base):
    __tablename__ = "article_tags"
    __table_args__ = (UniqueConstraint("article_id", "tag_id", name="uq_article_tag"),)

    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id"), primary_key=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("tags.id"), primary_key=True)


class Article(Base):
    __tablename__ = "articles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    slug: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    summary: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    content_markdown: Mapped[str] = mapped_column(Text)
    content_html: Mapped[str] = mapped_column(Text)
    cover_image: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[ArticleStatus] = mapped_column(SAEnum(ArticleStatus), default=ArticleStatus.DRAFT, index=True)
    is_top: Mapped[bool] = mapped_column(Boolean, default=False)
    views: Mapped[int] = mapped_column(Integer, default=0)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categories.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    author: Mapped[User] = relationship()


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("comments.id"), nullable=True, index=True)
    content: Mapped[str] = mapped_column(Text)
    status: Mapped[CommentStatus] = mapped_column(SAEnum(CommentStatus), default=CommentStatus.NORMAL)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


# Schemas
class TokenResponse(BaseModel):
    token: str
    expires_in: int


class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str


class RegisterResponse(BaseModel):
    id: int
    username: str
    token: str


class LoginRequest(BaseModel):
    username: str
    password: str


class ArticleCreateRequest(BaseModel):
    title: str
    summary: Optional[str] = None
    content_markdown: str
    category_id: Optional[int] = None
    tags: List[str] = []
    status: ArticleStatus = ArticleStatus.DRAFT


class ArticleUpdateRequest(BaseModel):
    title: Optional[str] = None
    summary: Optional[str] = None
    content_markdown: Optional[str] = None
    category_id: Optional[int] = None
    tags: Optional[List[str]] = None
    status: Optional[ArticleStatus] = None


class CommentCreateRequest(BaseModel):
    content: str
    parent_id: Optional[int] = None


# Helpers

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_token(user: User) -> str:
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role.value,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=ACCESS_TOKEN_EXPIRE_SECONDS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload["sub"])
    except (JWTError, KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user = db.get(User, user_id)
    if not user or user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user")
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.ROLE_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return user


def upsert_tags(db: Session, tag_names: List[str]) -> List[Tag]:
    tags: List[Tag] = []
    for name in {x.strip() for x in tag_names if x.strip()}:
        existing = db.scalar(select(Tag).where(Tag.name == name))
        if existing:
            tags.append(existing)
        else:
            t = Tag(name=name)
            db.add(t)
            db.flush()
            tags.append(t)
    return tags


def set_article_tags(db: Session, article_id: int, tag_names: List[str]) -> None:
    db.query(ArticleTag).filter(ArticleTag.article_id == article_id).delete()
    tags = upsert_tags(db, tag_names)
    for t in tags:
        db.add(ArticleTag(article_id=article_id, tag_id=t.id))


def render_markdown(md: str) -> str:
    return md.replace("\n", "<br>")


def build_comment_tree(rows: List[Comment], users: dict[int, User]):
    nodes = {
        c.id: {
            "id": c.id,
            "content": c.content,
            "user": {"id": c.user_id, "username": users[c.user_id].username},
            "children": [],
            "parent_id": c.parent_id,
        }
        for c in rows
        if c.status == CommentStatus.NORMAL
    }
    roots = []
    for node in nodes.values():
        pid = node["parent_id"]
        if pid and pid in nodes:
            nodes[pid]["children"].append({k: v for k, v in node.items() if k != "parent_id"})
        else:
            roots.append({k: v for k, v in node.items() if k != "parent_id"})
    return roots


app = FastAPI(title="Personal Blog API", version="1.0.0")


@app.on_event("startup")
def startup():
    Base.metadata.create_all(engine)


@app.post("/api/v1/auth/register", response_model=RegisterResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.username == payload.username)):
        raise HTTPException(status_code=400, detail="Username already exists")
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(status_code=400, detail="Email already exists")

    role = UserRole.ROLE_ADMIN if db.scalar(select(func.count(User.id))) == 0 else UserRole.ROLE_USER
    user = User(username=payload.username, email=payload.email, password_hash=hash_password(payload.password), role=role)
    db.add(user)
    db.commit()
    db.refresh(user)
    return RegisterResponse(id=user.id, username=user.username, token=create_token(user))


@app.post("/api/v1/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == payload.username))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return TokenResponse(token=create_token(user), expires_in=ACCESS_TOKEN_EXPIRE_SECONDS)


@app.get("/api/v1/articles")
def list_articles(
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
    category_id: Optional[int] = None,
    tag: Optional[str] = None,
    keyword: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = select(Article).where(Article.status == ArticleStatus.PUBLISHED)
    if category_id is not None:
        q = q.where(Article.category_id == category_id)
    if keyword:
        q = q.where(Article.title.ilike(f"%{keyword}%"))
    if tag:
        q = q.join(ArticleTag, ArticleTag.article_id == Article.id).join(Tag, Tag.id == ArticleTag.tag_id).where(Tag.name == tag)

    total = len(db.scalars(q).all())
    data_rows = db.scalars(q.order_by(Article.published_at.desc().nullslast()).offset((page - 1) * size).limit(size)).all()

    data = [
        {
            "id": a.id,
            "title": a.title,
            "summary": a.summary,
            "slug": a.slug,
            "views": a.views,
            "published_at": a.published_at,
        }
        for a in data_rows
    ]
    return {"total": total, "page": page, "size": size, "data": data}


@app.get("/api/v1/articles/{article_id}")
def article_detail(article_id: int, db: Session = Depends(get_db)):
    article = db.get(Article, article_id)
    if not article or article.status != ArticleStatus.PUBLISHED:
        raise HTTPException(status_code=404, detail="Article not found")

    article.views += 1
    db.commit()

    tags = db.scalars(
        select(Tag).join(ArticleTag, Tag.id == ArticleTag.tag_id).where(ArticleTag.article_id == article.id)
    ).all()

    return {
        "id": article.id,
        "title": article.title,
        "content_html": article.content_html,
        "views": article.views,
        "author": {"id": article.author.id, "username": article.author.username},
        "tags": [{"id": t.id, "name": t.name} for t in tags],
    }


@app.post("/api/v1/admin/articles")
def create_article(payload: ArticleCreateRequest, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    slug = payload.title.lower().strip().replace(" ", "-")
    if db.scalar(select(Article).where(Article.slug == slug)):
        slug = f"{slug}-{int(datetime.now().timestamp())}"

    article = Article(
        title=payload.title,
        slug=slug,
        summary=payload.summary,
        content_markdown=payload.content_markdown,
        content_html=render_markdown(payload.content_markdown),
        status=payload.status,
        author_id=_.id,
        category_id=payload.category_id,
        published_at=datetime.now(timezone.utc) if payload.status == ArticleStatus.PUBLISHED else None,
    )
    db.add(article)
    db.flush()
    set_article_tags(db, article.id, payload.tags)
    db.commit()
    db.refresh(article)
    return {"id": article.id, "slug": article.slug, "status": article.status}


@app.put("/api/v1/admin/articles/{article_id}")
def update_article(article_id: int, payload: ArticleUpdateRequest, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")

    if payload.title is not None:
        article.title = payload.title
    if payload.summary is not None:
        article.summary = payload.summary
    if payload.content_markdown is not None:
        article.content_markdown = payload.content_markdown
        article.content_html = render_markdown(payload.content_markdown)
    if payload.category_id is not None:
        article.category_id = payload.category_id
    if payload.status is not None:
        article.status = payload.status
        article.published_at = datetime.now(timezone.utc) if payload.status == ArticleStatus.PUBLISHED else None
    if payload.tags is not None:
        set_article_tags(db, article.id, payload.tags)

    db.commit()
    return {"id": article.id, "status": article.status}


@app.delete("/api/v1/admin/articles/{article_id}")
def delete_article(article_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    article = db.get(Article, article_id)
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")
    article.status = ArticleStatus.DELETED
    db.commit()
    return {"message": "Article soft-deleted"}


@app.post("/api/v1/articles/{article_id}/comments")
def create_comment(article_id: int, payload: CommentCreateRequest, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    article = db.get(Article, article_id)
    if not article or article.status != ArticleStatus.PUBLISHED:
        raise HTTPException(status_code=404, detail="Article not found")

    if payload.parent_id:
        parent = db.get(Comment, payload.parent_id)
        if not parent or parent.article_id != article_id:
            raise HTTPException(status_code=400, detail="Invalid parent comment")

    c = Comment(article_id=article_id, user_id=user.id, parent_id=payload.parent_id, content=payload.content)
    db.add(c)
    db.commit()
    db.refresh(c)
    return {"id": c.id, "content": c.content, "parent_id": c.parent_id}


@app.get("/api/v1/articles/{article_id}/comments")
def list_comments(article_id: int, db: Session = Depends(get_db)):
    article = db.get(Article, article_id)
    if not article or article.status != ArticleStatus.PUBLISHED:
        raise HTTPException(status_code=404, detail="Article not found")

    comments = db.scalars(select(Comment).where(Comment.article_id == article_id).order_by(Comment.created_at.asc())).all()
    user_ids = {c.user_id for c in comments}
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(user_ids))).all()} if user_ids else {}
    return build_comment_tree(comments, users)
