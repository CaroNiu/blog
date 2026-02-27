from fastapi.testclient import TestClient

from app.main import Base, app, engine


client = TestClient(app)


def setup_function():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def test_register_login_and_article_flow():
    register = client.post(
        "/api/v1/auth/register",
        json={"username": "admin", "email": "admin@example.com", "password": "secret123"},
    )
    assert register.status_code == 200
    admin_token = register.json()["token"]

    create_article = client.post(
        "/api/v1/admin/articles",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "title": "Hello Blog",
            "summary": "Summary",
            "content_markdown": "Hello\nWorld",
            "tags": ["Python", "FastAPI"],
            "status": "PUBLISHED",
        },
    )
    assert create_article.status_code == 200
    article_id = create_article.json()["id"]

    article_list = client.get("/api/v1/articles")
    assert article_list.status_code == 200
    assert article_list.json()["total"] == 1

    detail = client.get(f"/api/v1/articles/{article_id}")
    assert detail.status_code == 200
    assert detail.json()["title"] == "Hello Blog"

    register_user = client.post(
        "/api/v1/auth/register",
        json={"username": "alice", "email": "alice@example.com", "password": "secret123"},
    )
    assert register_user.status_code == 200
    user_token = register_user.json()["token"]

    comment = client.post(
        f"/api/v1/articles/{article_id}/comments",
        headers={"Authorization": f"Bearer {user_token}"},
        json={"content": "Nice post", "parent_id": None},
    )
    assert comment.status_code == 200

    comments = client.get(f"/api/v1/articles/{article_id}/comments")
    assert comments.status_code == 200
    assert len(comments.json()) == 1
