from django.shortcuts import get_object_or_404
from django.views.decorators.http import require_POST, require_GET
from django.contrib.admin.views.autocomplete import JsonResponse
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework import generics, mixins, permissions, viewsets

from api import serializer
from api.models import QueryExample, SavedQuery, SparqlEndpointConfiguration
from api.serializer import (
    QueryExampleSerializer,
    SparqlEndpointConfigurationListSerializer,
    SparqlEndpointConfigurationSerializer,
    SparqlEndpointTemplatesSerializer,
)


class SparqlEndpointConfigurationViewSet(
    mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    queryset = SparqlEndpointConfiguration.objects.exclude(sort_key="0").order_by(
        "sort_key"
    )
    serializer_class = SparqlEndpointConfigurationSerializer
    lookup_field = "slug"


class SparqlEndpointConfigurationListViewSet(generics.ListAPIView):
    """
    API that lists all available backends; see `serializer.py`.
    """

    queryset = SparqlEndpointConfiguration.objects.exclude(sort_key="0").order_by(
        "sort_key"
    )
    serializer_class = SparqlEndpointConfigurationListSerializer


class QueryExampleListViewSet(generics.ListCreateAPIView):
    serializer_class = QueryExampleSerializer
    lookup_field = "slug"

    def get_queryset(self):
        backend_slug = self.kwargs["slug"]
        return QueryExample.objects.filter(backend__slug=backend_slug)

    def get_permissions(self):
        if self.request.method == "POST":
            return [permissions.IsAuthenticated()]
        return []

    def perform_create(self, serializer):
        backend = get_object_or_404(
            SparqlEndpointConfiguration, slug=self.kwargs["slug"]
        )
        name = serializer.validated_data.get("name")

        if self.request.query_params.get("create") == "true":
            if QueryExample.objects.filter(backend=backend, name=name).exists():
                from rest_framework.exceptions import ValidationError

                raise ValidationError(
                    {"name": "An example with this name already exists."}
                )
            serializer.save(backend=backend)
        else:
            example = get_object_or_404(QueryExample, backend=backend, name=name)
            example.query = serializer.validated_data["query"]
            example.save()


class SparqlEndpointTemplatesViewSet(mixins.UpdateModelMixin, viewsets.GenericViewSet):
    queryset = SparqlEndpointConfiguration.objects.all()
    serializer_class = SparqlEndpointTemplatesSerializer
    lookup_field = "slug"
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["patch"]


# NOTE: This function is not guarded!
# Everybody can make post requests and create share links!
@csrf_exempt
@require_POST
def get_or_create_share_link(request):
    """
    Get or generate a sharing link for a SPARQL query
    """
    query: str = request.body.decode("utf-8")
    (saved_query, _created) = SavedQuery.objects.get_or_create(content=query)
    return HttpResponse(saved_query.id)


@require_GET
def get_saved_query(request, id: str):
    """
    Get or generate a sharing link for a SPARQL query
    """
    saved_query = get_object_or_404(SavedQuery, id=id)
    return HttpResponse(saved_query.content)
