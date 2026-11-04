from django.urls import path

from .views import health, user_detail, users_me

urlpatterns = [
    path("health", health, name="health"),
    path("users/me", users_me, name="users-me"),
    path("users/<str:sub>", user_detail, name="user-detail"),
]
