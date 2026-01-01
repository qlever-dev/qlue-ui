import secrets
import string
from django.db import models, transaction


class SparqlEndpointConfiguration(models.Model):
    class Engine(models.IntegerChoices):
        QLEVER = 1, "QLever"
        GRAPH_DB = 2, "GraphDB"
        VIRTUOSO = 3, "Virtuoso"
        MILLENNIUM_DB = 4, "MillenniumDB"
        BLAZEGRAPH = 5, "Blazegraph"
        JENA = 6, "Jena"

    name = models.CharField(
        max_length=100,
        help_text="Choose a name for the backend that helps you to distinguish between multiple backends",
        verbose_name="Name",
        unique=True,
    )
    engine = models.IntegerField(
        choices=Engine, null=True, blank=True, default=Engine.QLEVER
    )
    slug = models.CharField(
        max_length=100,
        help_text="Name used in the URL of this backend; MUST only use valid URL characters (in particular, no space)",
        verbose_name="Slug",
    )
    is_default = models.BooleanField(
        default=False,
        help_text="Whether or not this SPARQL endpoint is used by default.",
        verbose_name="Default SPARQL endpoint",
    )
    sort_key = models.CharField(
        max_length=10,
        default="0",
        help_text="Sort key, according to which backends are ordered lexicographically; DO NOT SHOW if this value is zero",
        verbose_name="Sort Key",
    )
    url = models.CharField(
        max_length=1000,
        help_text="The URL where to find / call the QLever backend (including http://)",
        verbose_name="Base URL",
    )
    api_token = models.CharField(
        max_length=32,
        help_text="This token needs to be provided as ?token query parameter when executing Warmup tasks through API",
        verbose_name="API token",
        default="",
        blank=True,
    )
    prefixes = models.TextField(
        default="",
        blank=True,
        help_text="A list of prefixes that should be suggested. Prefixes can have either of @prefix schema: &lt;https://www.schema.org/&gt; .",
        verbose_name="Suggested Prefixes",
    )
    subject_completion = models.TextField(
        default="",
        blank=True,
        help_text="The query for subject autocompletion.",
        verbose_name="Subject completion",
    )
    predicate_completion_context_sensitive = models.TextField(
        default="",
        blank=True,
        help_text="The query for <em>context-sensitive</em> predicate autocompletion",
        verbose_name="Predicate completion (context sensitive)",
    )
    predicate_completion_context_insensitive = models.TextField(
        default="",
        blank=True,
        help_text="The query for <em>context-insensitive</em> predicate autocompletion",
        verbose_name="Predicate completion (context insensitive)",
    )
    object_completion_context_sensitive = models.TextField(
        default="",
        blank=True,
        help_text="The query for <em>context-sensitive</em> object autocompletion",
        verbose_name="Object completion (context sensitive)",
    )
    object_completion_context_insensitive = models.TextField(
        default="",
        blank=True,
        help_text="The query for <em>context-insensitive</em> object autocompletion",
        verbose_name="Object completion (context insensitive)",
    )

    @property
    def is_hidden(self) -> bool:
        return self.sort_key == "0"

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        if self.is_default:
            with transaction.atomic():
                SparqlEndpointConfiguration.objects.filter(is_default=True).exclude(
                    pk=self.pk
                ).update(is_default=False)
        super().save(*args, **kwargs)


class QueryExample(models.Model):
    backend = models.ForeignKey(SparqlEndpointConfiguration, on_delete=models.CASCADE)
    name = models.CharField(
        max_length=100,
        help_text="Name of this example to show in the user interface",
    )
    query = models.TextField()
    sort_key = models.CharField(
        max_length=100,
        default="~",
        help_text=(
            "Sort key, according to which example queries are ordered lexicographically"
            "; default is '~', which is larger than most characters"
        ),
        verbose_name="Sort key",
    )


class SavedQuery(models.Model):
    id = models.CharField(
        primary_key=True,
        editable=False,
        max_length=6,
    )
    content = models.TextField()

    def save(self, *args, **kwargs):
        def generate_id():
            return "".join(
                secrets.choice(string.ascii_letters + string.digits) for _ in range(6)
            )

        if not self.id:
            # Keep generating until it's unique
            new_id = generate_id()
            while SavedQuery.objects.filter(id=new_id).exists():
                new_id = generate_id()
            self.id = new_id

        super().save(*args, **kwargs)


class CompareGroup(models.Model):
    name = models.CharField()
    endpoints = models.ManyToManyField(SparqlEndpointConfiguration)

    def endpoints_list(self) -> str:
        return ", ".join(endpoint.name for endpoint in self.endpoints.all())
