#!/usr/bin/env python3
"""Fetch backend configs from API and dump as YAML with block-style multiline strings."""

import json
import sys

import requests
from ruamel.yaml import YAML
from ruamel.yaml.scalarstring import LiteralScalarString

BASE_URL = "http://127.0.0.1:8000/api/backends/"


def make_block_strings(obj):
    """Recursively convert any multiline strings to LiteralScalarString (|-) style."""
    if isinstance(obj, str):
        obj = obj.replace("\r\n", "\n")
        # Remove empty lines
        obj = "\n".join(line for line in obj.split("\n") if line.strip())
        if "\n" in obj:
            return LiteralScalarString(obj)
        return obj
    elif isinstance(obj, dict):
        return {k: make_block_strings(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [make_block_strings(item) for item in obj]
    return obj


def fetch_backends():
    resp = requests.get(BASE_URL)
    resp.raise_for_status()
    return resp.json()


def fetch_backend_detail(api_url):
    resp = requests.get(api_url)
    resp.raise_for_status()
    return resp.json()


def restructure(data):
    """Restructure the data as needed. Edit this function to your liking."""
    # For now: merge summary info with full detail
    result = {
        "name": data["name"],
        "url": data["url"],
        "is_default": data["is_default"],
        "sort_key": data["sort_key"],
        "engine": data["engine"],
        "map_view_url": data["map_view_url"],
        "prefix_map": data["prefix_map"],
        "completion_templates": {
            "subject_completion": data["subject_completion"],
            "predicate_completion_context_sensitive": data[
                "predicate_completion_context_sensitive"
            ],
            "predicate_completion_context_insensitive": data[
                "predicate_completion_context_insensitive"
            ],
            "object_completion_context_sensitive": data[
                "object_completion_context_sensitive"
            ],
            "object_completion_context_insensitive": data[
                "object_completion_context_insensitive"
            ],
            "values_completion_context_sensitive": data[
                "values_completion_context_sensitive"
            ],
            "values_completion_context_insensitive": data[
                "values_completion_context_insensitive"
            ],
            "hover": data["hover"],
        },
    }
    return result


def main():
    print(f"Fetching backends from {BASE_URL} ...", file=sys.stderr)
    backends = fetch_backends()
    print(f"Found {len(backends)} backends.", file=sys.stderr)

    result = {}
    for b in backends:
        print(f"  Fetching detail for {b['slug']} ...", file=sys.stderr)
        detail = fetch_backend_detail(b["api_url"])
        restructured = restructure(detail)
        result[b["slug"]] = restructured

    # Convert multiline strings to block scalar style
    all_data = make_block_strings(result)

    # Dump as YAML
    yaml = YAML()
    yaml.default_flow_style = False
    yaml.dump(all_data, sys.stdout)


if __name__ == "__main__":
    main()
