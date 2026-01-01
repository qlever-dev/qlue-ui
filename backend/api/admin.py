from django.contrib import admin
from django.contrib.admin.utils import timezone

from api.models import (
    CompareGroup,
    QueryExample,
    SavedQuery,
    SparqlEndpointConfiguration,
)


@admin.action(description="Create a new ComapreGroup from selected endpoints")
def create_compare_group(modeladmin, request, queryset):
    if not queryset.exists():
        return

    # Example name – customize as needed
    name = f"CompareGroup ({queryset.count()} items) {timezone.now():%Y-%m-%d %H:%M:%S}"

    compare_group = CompareGroup.objects.create(name=name)
    compare_group.endpoints.set(queryset)

    modeladmin.message_user(
        request,
        f"CompareGroup '{compare_group.name}' created with {queryset.count()} items.",
    )


@admin.register(SparqlEndpointConfiguration)
class SparqlEndpointConfigurationAdmin(admin.ModelAdmin):
    list_display = ["name", "url", "engine", "is_default", "is_hidden"]
    search_fields = ("name", "slug")
    actions = [create_compare_group]
    fieldsets = (
        (
            "General",
            {
                "fields": (
                    "name",
                    "slug",
                    "engine",
                    "is_default",
                    "sort_key",
                    "url",
                    "api_token",
                )
            },
        ),
        (
            "Prefix Map",
            {
                "fields": ("prefixes",),
                "classes": ["collapse"],
            },
        ),
        (
            "Completion Queries",
            {
                "fields": (
                    "subject_completion",
                    "predicate_completion_context_sensitive",
                    "predicate_completion_context_insensitive",
                    "object_completion_context_sensitive",
                    "object_completion_context_insensitive",
                ),
                "classes": ["collapse"],
            },
        ),
    )


@admin.register(QueryExample)
class QueryExampleAdmin(admin.ModelAdmin):
    list_display = ["id", "backend__name", "name"]
    search_fields = ["name"]


@admin.register(SavedQuery)
class SavedQueryAdmin(admin.ModelAdmin):
    list_display = ["id", "content"]


@admin.register(CompareGroup)
class CompareEndpointsAdmin(admin.ModelAdmin):
    list_display = ["name", "endpoints_list"]

    @admin.display(description="Endpoints")
    def endpoints_list(self, obj):
        return ", ".join(obj.endpoints.values_list("name", flat=True))
