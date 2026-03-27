from datetime import date
from typing import Any, Optional
from pydantic import AnyUrl, BaseModel, ConfigDict, HttpUrl, RootModel, ValidationError
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
    )


class Query_Templates(CamelModel):
    subject_completion: Optional[str]
    predicate_completion_context_sensitive: Optional[str]
    predicate_completion_context_insensitive: Optional[str]
    object_completion_context_sensitive: Optional[str]
    object_completion_context_insensitive: Optional[str]
    values_completion_context_sensitive: Optional[str]
    values_completion_context_insensitive: Optional[str]
    hover: Optional[str]


class SparqlEndpointConfiguration(CamelModel):
    name: str
    url: HttpUrl
    engine: Optional[str] = None
    default: bool
    prefix_map: Optional[dict[str, AnyUrl]] = None
    map_view_url: Optional[str] = None
    query_templates: Optional[Query_Templates] = None


class AppConfig(RootModel[dict[str, SparqlEndpointConfiguration]]):
    pass


def validate_config(data: dict[str, Any]) -> dict[str, Any]:
    """Validate and return the normalized dict. Raises ValueError on failure."""
    try:
        config = AppConfig.model_validate(data)
        return config.model_dump()
    except ValidationError as exc:
        raise ValueError(f"Schema validation failed:\n{exc}") from exc


class SharedQuery(CamelModel):
    id: str
    query: str
    creation_date: date
