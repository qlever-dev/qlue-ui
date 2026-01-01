from django.contrib.admin.utils import lookup_field
from api.models import QueryExample, SparqlEndpointConfiguration
from rest_framework import serializers


class SparqlEndpointConfigurationSerializer(serializers.HyperlinkedModelSerializer):
    prefix_map = serializers.SerializerMethodField()
    engine = serializers.CharField(source="get_engine_display")

    class Meta:
        model = SparqlEndpointConfiguration
        exclude = ["api_token", "prefixes"]

    def get_prefix_map(self, obj):
        prefixes = obj.prefixes.split("\n")
        result = {}
        for prefix in prefixes:
            line = prefix.strip()
            if line == "":
                continue
            words = line.split()
            if words[1][-1] != ":":
                continue
            elif words[2][0] != "<":
                continue
            elif words[2][-1] != ">":
                continue
            result[words[1][:-1]] = words[2][1:-1]
        return result


class SparqlEndpointConfigurationListSerializer(serializers.ModelSerializer):
    """
    Serializer for listing all backends, each with their name, slug
    and the API url. This is not the url of the SPARQL endpoint but the URL
    of the UI API detail endpoint.
    """

    api_url = serializers.HyperlinkedIdentityField(
        view_name="backend-detail", lookup_field="slug"
    )

    class Meta:
        model = SparqlEndpointConfiguration
        fields = ["name", "slug", "api_url", "is_default"]


class QueryExampleSerializer(serializers.ModelSerializer):
    class Meta:
        model = QueryExample
        fields = ["name", "query"]
