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
    map_view_url = models.CharField(
        max_length=256,
        help_text="This URL points to the petrimaps service. This service vizualizes geo data.",
        verbose_name="Map-view URL",
        default="https://qlever.dev/petrimaps/",
    )
    prefixes = models.TextField(
        default=(
            "PREFIX owl: <http://www.w3.org/2002/07/owl#>\n"
            "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\n"
            "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>\n"
            "PREFIX schema: <http://schema.org/>\n"
            "PREFIX skos: <http://www.w3.org/2004/02/skos/core#>\n"
            "PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>\n"
            "PREFIX foaf: <http://xmlns.com/foaf/0.1/>"
        ),
        blank=True,
        help_text="A list of prefixes that should be suggested. Use this notation: PREFIX schema: &lt;https://www.schema.org/&gt;",
        verbose_name="Suggested Prefixes",
    )
    subject_completion = models.TextField(
        default="""\
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

    SELECT ?qlue_ls_entity ?qlue_ls_label ?qlue_ls_alias ?qlue_ls_count WHERE {
      {
        SELECT ?qlue_ls_entity (COUNT(*) AS ?qlue_ls_count) WHERE {
          ?qlue_ls_entity ?p ?o .
          {% if search_term %}
          ?qlue_ls_entity rdfs:label ?searchLabel .
          FILTER(LANG(?searchLabel) = "en" || LANG(?searchLabel) = "")
          FILTER(REGEX(STR(?searchLabel), "^{{ search_term }}", "i"))
          {% endif %}
        }
        GROUP BY ?qlue_ls_entity
        ORDER BY DESC(?qlue_ls_count)
        LIMIT {{ limit }}
        OFFSET {{ offset }}
      }
      OPTIONAL {
        ?qlue_ls_entity rdfs:label ?qlue_ls_label .
        FILTER(LANG(?qlue_ls_label) = "en" || LANG(?qlue_ls_label) = "")
      }
      OPTIONAL {
        ?qlue_ls_entity rdfs:comment ?qlue_ls_alias .
        FILTER(LANG(?qlue_ls_alias) = "en" || LANG(?qlue_ls_alias) = "")
      }
    }""",
        blank=True,
        help_text="The query for subject autocompletion.",
        verbose_name="Subject completion",
    )
    predicate_completion_context_sensitive = models.TextField(
        default="""\
    # Inherit PREFIX declarations from the editor document and configuration
    {% include "prefix_declarations" %}
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    
    SELECT ?qlue_ls_entity ?qlue_ls_label ?qlue_ls_alias ?qlue_ls_count WHERE {
      {
        # Inner query: use surrounding context + local triple pattern to find
        # predicates actually used in this subject's neighbourhood
        SELECT ?qlue_ls_entity (COUNT(*) AS ?qlue_ls_count) WHERE {
          {{ context }}
          {{ local_context }}
          {% if search_term_uncompressed %}
          # User typed a prefixed IRI (e.g. rdf:type) — match against the expanded IRI string
          FILTER(STRSTARTS(STR(?qlue_ls_entity), "^{{ search_term_uncompressed }}"))
          {% elif search_term %}
          # User typed a plain text term — match against the predicate's label;
          # accept English labels and untagged literals so language-free graphs still work
          ?qlue_ls_entity rdfs:label ?searchLabel .
          FILTER(LANG(?searchLabel) = "en" || LANG(?searchLabel) = "")
          FILTER(REGEX(STR(?searchLabel), "^{ search_term }}", "i"))
          {% endif %}
        }
        GROUP BY ?qlue_ls_entity
        ORDER BY DESC(?qlue_ls_count)
        LIMIT {{ limit }}
        OFFSET {{ offset }}
      }
      # Fetch human-readable label for display; prefer English, allow untagged fallback
      OPTIONAL {
        ?qlue_ls_entity rdfs:label ?qlue_ls_label .
        FILTER(LANG(?qlue_ls_label) = "en" || LANG(?qlue_ls_label) = "")
      }
      # Fetch description for the completion item detail line
      OPTIONAL {
        ?qlue_ls_entity rdfs:comment ?qlue_ls_alias .
        FILTER(LANG(?qlue_ls_alias) = "en" || LANG(?qlue_ls_alias) = "")
      }
    }""",
        blank=True,
        help_text="The query for <em>context-sensitive</em> predicate autocompletion",
        verbose_name="Predicate completion (context sensitive)",
    )
    predicate_completion_context_insensitive = models.TextField(
        default="""\
    # Inherit PREFIX declarations from the editor document and configuration
    {% include "prefix_declarations" %}
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    
    SELECT ?qlue_ls_entity ?qlue_ls_label ?qlue_ls_alias ?qlue_ls_count WHERE {
      {
        # Inner query: scan all triples and rank predicates by usage frequency
        SELECT ?qlue_ls_entity (COUNT(*) AS ?qlue_ls_count) WHERE {
          ?s ?qlue_ls_entity ?o .
          {% if search_term_uncompressed %}
          # User typed a prefixed IRI (e.g. rdf:type) — match against the expanded IRI string
          FILTER(STRSTARTS(STR(?qlue_ls_entity), "^{{ search_term_uncompressed }}"))
          {% elif search_term %}
          # User typed a plain text term — match against the predicate's label;
          # accept English labels and untagged literals so language-free graphs still work
          ?qlue_ls_entity rdfs:label ?searchLabel .
          FILTER(LANG(?searchLabel) = "en" || LANG(?searchLabel) = "")
          FILTER(REGEX(STR(?searchLabel), "^{{ search_term }}", "i"))
          {% endif %}
        }
        GROUP BY ?qlue_ls_entity
        ORDER BY DESC(?qlue_ls_count)
        LIMIT {{ limit }}
        OFFSET {{ offset }}
      }
      # Fetch human-readable label for display; prefer English, allow untagged fallback
      OPTIONAL {
        ?qlue_ls_entity rdfs:label ?qlue_ls_label .
        FILTER(LANG(?qlue_ls_label) = "en" || LANG(?qlue_ls_label) = "")
      }
      # Fetch description for the completion item detail line
      OPTIONAL {
        ?qlue_ls_entity rdfs:comment ?qlue_ls_alias .
        FILTER(LANG(?qlue_ls_alias) = "en" || LANG(?qlue_ls_alias) = "")
      }
    }""",
        blank=True,
        help_text="The query for <em>context-insensitive</em> predicate autocompletion",
        verbose_name="Predicate completion (context insensitive)",
    )
    object_completion_context_sensitive = models.TextField(
        default="""\
    # Inherit PREFIX declarations from the editor document and configuration
    {% include "prefix_declarations" %}
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    
    SELECT ?qlue_ls_entity ?qlue_ls_label ?qlue_ls_alias ?qlue_ls_count WHERE {
      {
        # Inner query: use surrounding context + local triple pattern to narrow
        # candidate objects to those consistent with the known predicate/subject
        SELECT ?qlue_ls_entity (COUNT(*) AS ?qlue_ls_count) WHERE {
          {{ context }}
          {{ local_context }}
        }
        GROUP BY ?qlue_ls_entity
        ORDER BY DESC(?qlue_ls_count)
        LIMIT {{ limit }}
        OFFSET {{ offset }}
      }
      # Fetch human-readable label for display; prefer English, allow untagged fallback
      OPTIONAL {
        ?qlue_ls_entity rdfs:label ?qlue_ls_label .
        FILTER(LANG(?qlue_ls_label) = "en" || LANG(?qlue_ls_label) = "")
      }
      # Fetch description for the completion item detail line
      OPTIONAL {
        ?qlue_ls_entity rdfs:comment ?qlue_ls_alias .
        FILTER(LANG(?qlue_ls_alias) = "en" || LANG(?qlue_ls_alias) = "")
      }
      {% if search_term_uncompressed %}
      # User typed a prefixed IRI — match against the expanded IRI string
      FILTER(STRSTARTS(STR(?qlue_ls_entity), "^{{ search_term_uncompressed }}"))
      {% elif search_term %}
      # User typed plain text — match against label or description;
      # applied in the outer query so it can reference the fetched label/alias variables
      FILTER(
        REGEX(STR(?qlue_ls_label), "^{{ search_term }}", "i")
        || REGEX(STR(?qlue_ls_alias), "^{{ search_term }}", "i")
      )
      {% endif %}
    }""",
        blank=True,
        help_text="The query for <em>context-sensitive</em> object autocompletion",
        verbose_name="Object completion (context sensitive)",
    )
    object_completion_context_insensitive = models.TextField(
        default="""\
    # Inherit PREFIX declarations from the editor document and configuration
    {% include "prefix_declarations" %}
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
    
    SELECT ?qlue_ls_entity ?qlue_ls_label ?qlue_ls_alias ?qlue_ls_count WHERE {
      {
        # Inner query: scan all object positions, restrict to IRIs to avoid surfacing
        # raw string/numeric literals as completion candidates
        SELECT ?qlue_ls_entity (COUNT(*) AS ?qlue_ls_count) WHERE {
          ?s ?p ?qlue_ls_entity .
          FILTER(isIRI(?qlue_ls_entity))
        }
        GROUP BY ?qlue_ls_entity
        ORDER BY DESC(?qlue_ls_count)
        LIMIT {{ limit }}
        OFFSET {{ offset }}
      }
      # Fetch human-readable label for display; prefer English, allow untagged fallback
      OPTIONAL {
        ?qlue_ls_entity rdfs:label ?qlue_ls_label .
        FILTER(LANG(?qlue_ls_label) = "en" || LANG(?qlue_ls_label) = "")
      }
      # Fetch description for the completion item detail line
      OPTIONAL {
        ?qlue_ls_entity rdfs:comment ?qlue_ls_alias .
        FILTER(LANG(?qlue_ls_alias) = "en" || LANG(?qlue_ls_alias) = "")
      }
      {% if search_term_uncompressed %}
      # User typed a prefixed IRI — match against the expanded IRI string
      FILTER(STRSTARTS(STR(?qlue_ls_entity), "^{{ search_term_uncompressed }}"))
      {% elif search_term %}
      # User typed plain text — match against label or description;
      # applied in the outer query so it can reference the fetched label/alias variables
      FILTER(
        REGEX(STR(?qlue_ls_label), "^{{ search_term }}", "i")
        || REGEX(STR(?qlue_ls_alias), "^{{ search_term }}", "i")
      )
      {% endif %}
    }""",
        blank=True,
        help_text="The query for <em>context-insensitive</em> object autocompletion",
        verbose_name="Object completion (context insensitive)",
    )
    values_completion_context_sensitive = models.TextField(
        default="""\
    # Inherit PREFIX declarations from the editor document and configuration
    {% include "prefix_declarations" %}
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

    SELECT ?qlue_ls_entity ?qlue_ls_label ?qlue_ls_alias ?qlue_ls_count WHERE {
      {
        # Inner query: local_context is a BIND(?var AS ?qlue_ls_entity) expression;
        # context contains the connected triple patterns that constrain valid values
        SELECT ?qlue_ls_entity (COUNT(*) AS ?qlue_ls_count) WHERE {
          {{ context }}
          {{ local_context }}
        }
        GROUP BY ?qlue_ls_entity
        ORDER BY DESC(?qlue_ls_count)
        LIMIT {{ limit }}
        OFFSET {{ offset }}
      }
      # Fetch human-readable label for display; prefer English, allow untagged fallback
      OPTIONAL {
        ?qlue_ls_entity rdfs:label ?qlue_ls_label .
        FILTER(LANG(?qlue_ls_label) = "en" || LANG(?qlue_ls_label) = "")
      }
      # Fetch description for the completion item detail line
      OPTIONAL {
        ?qlue_ls_entity rdfs:comment ?qlue_ls_alias .
        FILTER(LANG(?qlue_ls_alias) = "en" || LANG(?qlue_ls_alias) = "")
      }
      {% if search_term_uncompressed %}
      # User typed a prefixed IRI — match against the expanded IRI string
      FILTER(STRSTARTS(STR(?qlue_ls_entity), "^{{ search_term_uncompressed }}"))
      {% elif search_term %}
      # User typed plain text — match against label or description;
      # applied in the outer query so it can reference the fetched label/alias variables
      FILTER(
        REGEX(STR(?qlue_ls_label), "^{{ search_term }}", "i")
        || REGEX(STR(?qlue_ls_alias), "^{{ search_term }}", "i")
      )
      {% endif %}
    }""",
        blank=True,
        help_text="The query for <em>context-sensitive</em> values autocompletion",
        verbose_name="Values completion (context sensitive)",
    )
    values_completion_context_insensitive = models.TextField(
        default="""\
    # Inherit PREFIX declarations from the editor document and configuration
    {% include "prefix_declarations" %}
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

    SELECT ?qlue_ls_entity ?qlue_ls_label ?qlue_ls_alias ?qlue_ls_count WHERE {
      {
        # Inner query: local_context is a BIND(?var AS ?qlue_ls_entity) expression;
        # no surrounding context available, so rank by general occurrence count
        SELECT ?qlue_ls_entity (COUNT(*) AS ?qlue_ls_count) WHERE {
          {{ local_context }}
          ?qlue_ls_entity ?p ?o .
        }
        GROUP BY ?qlue_ls_entity
        ORDER BY DESC(?qlue_ls_count)
        LIMIT {{ limit }}
        OFFSET {{ offset }}
      }
      # Fetch human-readable label for display; prefer English, allow untagged fallback
      OPTIONAL {
        ?qlue_ls_entity rdfs:label ?qlue_ls_label .
        FILTER(LANG(?qlue_ls_label) = "en" || LANG(?qlue_ls_label) = "")
      }
      # Fetch description for the completion item detail line
      OPTIONAL {
        ?qlue_ls_entity rdfs:comment ?qlue_ls_alias .
        FILTER(LANG(?qlue_ls_alias) = "en" || LANG(?qlue_ls_alias) = "")
      }
      {% if search_term_uncompressed %}
      # User typed a prefixed IRI — match against the expanded IRI string
      FILTER(STRSTARTS(STR(?qlue_ls_entity), "^{{ search_term_uncompressed }}"))
      {% elif search_term %}
      # User typed plain text — match against label or description;
      # applied in the outer query so it can reference the fetched label/alias variables
      FILTER(
        REGEX(STR(?qlue_ls_label), "^{{ search_term }}", "i")
        || REGEX(STR(?qlue_ls_alias), "^{{ search_term }}", "i")
      )
      {% endif %}
    }""",
        blank=True,
        help_text="The query for <em>context-insensitive</em> values autocompletion",
        verbose_name="Values completion (context insensitive)",
    )
    hover = models.TextField(
        default="""\
    # Inherit PREFIX declarations from the editor document and configuration
    {% include "prefix_declarations" %}
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

    # {{ entity }} is the IRI currently under the cursor
    # Both fields are OPTIONAL so the tooltip still renders if only one is present
    SELECT ?qlue_ls_label ?qlue_ls_alias WHERE {
      # Fetch human-readable label; prefer English, allow untagged fallback
      OPTIONAL {
        {{ entity }} rdfs:label ?qlue_ls_label .
        FILTER(LANG(?qlue_ls_label) = "en" || LANG(?qlue_ls_label) = "")
      }
      # Fetch description shown as secondary detail in the tooltip
      OPTIONAL {
        {{ entity }} rdfs:comment ?qlue_ls_alias .
        FILTER(LANG(?qlue_ls_alias) = "en" || LANG(?qlue_ls_alias) = "")
      }
    }
    LIMIT 1
    """,
        blank=True,
        help_text="The query for fetching hover information for IRIs",
        verbose_name="Hover",
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
