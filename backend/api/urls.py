from django.urls import path
from api import views
from rest_framework import routers

urlpatterns = [
    path(
        "backends/",
        views.SparqlEndpointConfigurationListViewSet.as_view(),
        name="backend-list",
    ),
    path(
        "backends/<slug:slug>/",
        views.SparqlEndpointConfigurationViewSet.as_view({"get": "retrieve"}),
        name="backend-detail",
    ),
    path(
        "backends/<slug:slug>/examples",
        views.QueryExampleListViewSet.as_view(),
        name="backend-examples",
    ),
    path(
        "backends/<slug:slug>/templates",
        views.SparqlEndpointTemplatesViewSet.as_view({"patch": "partial_update"}),
        name="backend-templates",
    ),
    path("share/", views.get_or_create_share_link),
    path("share/<str:id>/", views.get_saved_query),
]
