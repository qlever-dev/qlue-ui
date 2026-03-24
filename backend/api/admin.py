from django.contrib import admin, messages
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


@admin.action(description="Copy selected configurations")
def copy_configurations(modeladmin, request, queryset):
    for original in queryset:
        examples = list(QueryExample.objects.filter(backend=original))

        original.pk = None
        original.name = f"Copy of {original.name}"
        original.slug = f"{original.slug}-copy"
        original.is_default = False
        original.save()

        # NOTE: setting pk to None makes save() insert a new row,
        # so the original examples remain untouched in the database
        for example in examples:
            example.pk = None
            example.backend = original
            example.save()

    count = queryset.count()
    modeladmin.message_user(
        request,
        f"Successfully copied {count} configuration(s).",
        messages.SUCCESS,
    )


@admin.register(SparqlEndpointConfiguration)
class SparqlEndpointConfigurationAdmin(admin.ModelAdmin):
    list_display = ["name", "url", "engine", "is_default", "is_hidden"]
    search_fields = ("name", "slug")
    actions = [create_compare_group, copy_configurations]
    fieldsets = (
        (
            "General",
            {
                "fields": (
                    "url",
                    "name",
                    "slug",
                    "engine",
                    "is_default",
                    "sort_key",
                    "api_token",
                    "map_view_url",
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
            "Queries",
            {
                "fields": (
                    "subject_completion",
                    "predicate_completion_context_sensitive",
                    "predicate_completion_context_insensitive",
                    "object_completion_context_sensitive",
                    "object_completion_context_insensitive",
                    "values_completion_context_sensitive",
                    "values_completion_context_insensitive",
                    "hover",
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
