"""
Export data from the development database to the distribution database.

This command exports selected models from your current (dev) database to the
distribution database (db.sqlite3.dist). The distribution database is meant
to be committed to version control and copied during deployment.

USAGE:
    python manage.py export_to_dist [options]

OPTIONS:
    --backends      Export SparqlEndpointConfiguration records
    --examples      Export QueryExample records
    --saved         Export SavedQuery records (usually NOT recommended)
    --all           Export all models
    --select        Interactively select which records to export (use with --backends or --examples)
    --update        Upsert mode: add/update records without deleting others (incremental sync)
    --delete        With --update: also delete records that only exist in destination
    --dry-run       Show what would be exported without making changes
    --force         Skip confirmation prompt

EXAMPLES:
    # Preview what backends would be exported
    python manage.py export_to_dist --backends --dry-run

    # Export all backends (RESET mode: wipe and replace)
    python manage.py export_to_dist --backends

    # Incremental update (upsert, keeps dist-only records)
    python manage.py export_to_dist --backends --update

    # Full sync (upsert + delete records not in source)
    python manage.py export_to_dist --backends --update --delete

    # Interactively select which backends to export
    python manage.py export_to_dist --backends --select

    # Selective update with interactive picker
    python manage.py export_to_dist --backends --select --update

    # Export backends and examples together
    python manage.py export_to_dist --backends --examples

    # Export everything (use with caution)
    python manage.py export_to_dist --all

WARNINGS:
    - Without --update: OVERWRITES data in the distribution database
    - With --update: Incrementally adds/updates records (safer)
    - With --update --delete: Full sync including deletions
    - SavedQuery contains user-generated content - think twice before exporting
    - QueryExample has a foreign key to SparqlEndpointConfiguration - if you
      export examples, the referenced backends must exist in the dist db
    - Always use --dry-run first to preview changes

DATA FLOW:
    [dev db.sqlite3] --export--> [db.sqlite3.dist]
"""

import sqlite3
from pathlib import Path

import questionary
from django.core.management.base import BaseCommand, CommandError
from django.conf import settings

from api.models import SparqlEndpointConfiguration, QueryExample, SavedQuery


class Command(BaseCommand):
    help = "Export data from dev database to distribution database (db.sqlite3.dist)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--backends",
            action="store_true",
            help="Export SparqlEndpointConfiguration records",
        )
        parser.add_argument(
            "--examples",
            action="store_true",
            help="Export QueryExample records",
        )
        parser.add_argument(
            "--saved",
            action="store_true",
            help="Export SavedQuery records (usually not recommended)",
        )
        parser.add_argument(
            "--all",
            action="store_true",
            help="Export all models",
        )
        parser.add_argument(
            "--select",
            action="store_true",
            help="Interactively select records (use with --backends or --examples)",
        )
        parser.add_argument(
            "--update",
            action="store_true",
            help="Upsert mode: add/update records without deleting others",
        )
        parser.add_argument(
            "--delete",
            action="store_true",
            help="With --update: also delete records not in source",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would be exported without making changes",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            help="Skip confirmation prompt",
        )

    def handle(self, *args, **options):
        dist_db_path = Path(settings.BASE_DIR).parent / "db.sqlite3.dist"

        if not dist_db_path.exists():
            raise CommandError(
                f"Distribution database not found at {dist_db_path}\n"
                "Create it first by copying your dev database:\n"
                "  cp backend/db.sqlite3 db.sqlite3.dist"
            )

        # Determine which models to export
        export_backends = options["backends"] or options["all"]
        export_examples = options["examples"] or options["all"]
        export_saved = options["saved"] or options["all"]
        interactive_select = options["select"]
        update_mode = options["update"]
        delete_mode = options["delete"]

        # Validate flag combinations
        if delete_mode and not update_mode:
            raise CommandError(
                "--delete requires --update.\n"
                "Use --update --delete for full sync with deletions."
            )

        if interactive_select and not any([export_backends, export_examples]):
            raise CommandError(
                "--select requires --backends or --examples.\n"
                "Example: --backends --select"
            )

        if not any([export_backends, export_examples, export_saved]):
            raise CommandError(
                "No models selected for export.\n"
                "Use --backends, --examples, --saved, or --all"
            )

        # Collect data to export
        exports = []

        if export_backends:
            if interactive_select:
                backends = self._interactive_backend_select(update_mode, dist_db_path)
                if backends is None:
                    self.stdout.write(self.style.WARNING("Selection cancelled."))
                    return
            else:
                backends = list(SparqlEndpointConfiguration.objects.all())
            if backends:
                exports.append(("SparqlEndpointConfiguration", backends))

        if export_examples:
            if interactive_select:
                examples = self._interactive_example_select(update_mode, dist_db_path)
                if examples is None:
                    self.stdout.write(self.style.WARNING("Selection cancelled."))
                    return
            else:
                examples = list(QueryExample.objects.all())
            if examples:
                exports.append(("QueryExample", examples))

        if export_saved:
            saved = list(SavedQuery.objects.all())
            exports.append(("SavedQuery", saved))

        if not exports:
            self.stdout.write(self.style.WARNING("No data selected for export."))
            return

        # Show summary
        self.stdout.write("\n" + "=" * 60)
        if update_mode:
            mode_str = "UPDATE" if not delete_mode else "SYNC"
            self.stdout.write(
                self.style.WARNING(f"EXPORT TO DISTRIBUTION DATABASE ({mode_str} MODE)")
            )
        else:
            self.stdout.write(
                self.style.WARNING("EXPORT TO DISTRIBUTION DATABASE (RESET MODE)")
            )
        self.stdout.write("=" * 60)
        self.stdout.write(f"\nTarget: {dist_db_path}\n")

        if update_mode:
            self._show_update_preview(exports, delete_mode, dist_db_path)
        else:
            self._show_reset_preview(exports)

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS("\n[DRY RUN] No changes made."))
            return

        # Confirmation
        self.stdout.write("")
        if update_mode:
            if delete_mode:
                self.stdout.write(
                    self.style.ERROR(
                        "WARNING: This will ADD, UPDATE, and DELETE records in the dist database!"
                    )
                )
            else:
                self.stdout.write(
                    self.style.WARNING(
                        "This will ADD and UPDATE records (existing dist-only records will be kept)."
                    )
                )
        else:
            self.stdout.write(
                self.style.ERROR(
                    "WARNING: This will OVERWRITE data in the dist database!"
                )
            )

        if export_saved:
            self.stdout.write(
                self.style.ERROR(
                    "WARNING: You are exporting SavedQuery - these are user-generated!"
                )
            )

        if not options["force"]:
            confirm = input("\nType 'yes' to confirm: ")
            if confirm.lower() != "yes":
                self.stdout.write(self.style.WARNING("Export cancelled."))
                return

        # Connect to distribution database
        conn = sqlite3.connect(dist_db_path)
        cursor = conn.cursor()

        try:
            # Export each model
            for model_name, records in exports:
                if model_name == "SparqlEndpointConfiguration":
                    if update_mode:
                        self._upsert_backends(cursor, records, delete_mode)
                    else:
                        self._export_backends(cursor, records)
                elif model_name == "QueryExample":
                    if update_mode:
                        self._upsert_examples(cursor, records, delete_mode)
                    else:
                        self._export_examples(cursor, records)
                elif model_name == "SavedQuery":
                    if update_mode:
                        self._upsert_saved(cursor, records, delete_mode)
                    else:
                        self._export_saved(cursor, records)

            conn.commit()
            self.stdout.write(self.style.SUCCESS("\nExport completed successfully!"))

        except Exception as e:
            conn.rollback()
            raise CommandError(f"Export failed: {e}")
        finally:
            conn.close()

    def _show_reset_preview(self, exports):
        """Show preview for reset mode."""
        self.stdout.write("Models to export:")

        for model_name, records in exports:
            self.stdout.write(f"  - {model_name}: {len(records)} records")
            if model_name == "SparqlEndpointConfiguration":
                for r in records:
                    self.stdout.write(f"      * {r.slug} ({r.name})")
            elif model_name == "QueryExample":
                for r in records:
                    self.stdout.write(f"      * {r.name} (backend: {r.backend.slug})")
            elif model_name == "SavedQuery":
                for r in records[:5]:
                    self.stdout.write(f"      * {r.id}")
                if len(records) > 5:
                    self.stdout.write(f"      * ... and {len(records) - 5} more")

    def _show_update_preview(self, exports, delete_mode, dist_db_path):
        """Show preview for update mode with [ADD], [UPDATE], [KEEP], [DELETE] labels."""
        # Connect to dist db to check existing records
        conn = sqlite3.connect(dist_db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        try:
            for model_name, records in exports:
                self.stdout.write(f"\n{model_name}:")

                if model_name == "SparqlEndpointConfiguration":
                    self._show_backend_update_preview(cursor, records, delete_mode)
                elif model_name == "QueryExample":
                    self._show_example_update_preview(cursor, records, delete_mode)
                elif model_name == "SavedQuery":
                    self._show_saved_update_preview(cursor, records, delete_mode)
        finally:
            conn.close()

    def _show_backend_update_preview(self, cursor, source_records, delete_mode):
        """Show update preview for backends."""
        cursor.execute("SELECT name, slug FROM api_sparqlendpointconfiguration")
        existing = {row["name"]: row["slug"] for row in cursor.fetchall()}
        source_names = {r.name for r in source_records}

        for r in source_records:
            if r.name in existing:
                self.stdout.write(f"  [UPDATE] {r.slug} ({r.name})")
            else:
                self.stdout.write(self.style.SUCCESS(f"  [ADD]    {r.slug} ({r.name})"))

        for name, slug in existing.items():
            if name not in source_names:
                if delete_mode:
                    self.stdout.write(self.style.ERROR(f"  [DELETE] {slug} ({name})"))
                else:
                    self.stdout.write(
                        self.style.WARNING(f"  [KEEP]   {slug} ({name}) (dist only)")
                    )

    def _show_example_update_preview(self, cursor, source_records, delete_mode):
        """Show update preview for examples."""
        cursor.execute(
            "SELECT e.name, b.name as backend_name, b.slug as backend_slug "
            "FROM api_queryexample e "
            "JOIN api_sparqlendpointconfiguration b ON e.backend_id = b.id"
        )
        existing = {
            (row["backend_name"], row["name"]): row["backend_slug"]
            for row in cursor.fetchall()
        }
        source_keys = {(r.backend.name, r.name) for r in source_records}

        for r in source_records:
            key = (r.backend.name, r.name)
            if key in existing:
                self.stdout.write(f"  [UPDATE] {r.name} ({r.backend.slug})")
            else:
                self.stdout.write(
                    self.style.SUCCESS(f"  [ADD]    {r.name} ({r.backend.slug})")
                )

        for key, backend_slug in existing.items():
            if key not in source_keys:
                backend_name, example_name = key
                if delete_mode:
                    self.stdout.write(
                        self.style.ERROR(f"  [DELETE] {example_name} ({backend_slug})")
                    )
                else:
                    self.stdout.write(
                        self.style.WARNING(
                            f"  [KEEP]   {example_name} ({backend_slug}) (dist only)"
                        )
                    )

    def _show_saved_update_preview(self, cursor, source_records, delete_mode):
        """Show update preview for saved queries."""
        cursor.execute("SELECT id FROM api_savedquery")
        existing_ids = {row["id"] for row in cursor.fetchall()}
        source_ids = {r.id for r in source_records}

        add_count = sum(1 for r in source_records if r.id not in existing_ids)
        update_count = sum(1 for r in source_records if r.id in existing_ids)

        if add_count > 0:
            self.stdout.write(self.style.SUCCESS(f"  [ADD]    {add_count} queries"))
        if update_count > 0:
            self.stdout.write(f"  [UPDATE] {update_count} queries")

        dist_only = existing_ids - source_ids
        if dist_only:
            if delete_mode:
                self.stdout.write(
                    self.style.ERROR(f"  [DELETE] {len(dist_only)} queries")
                )
            else:
                self.stdout.write(
                    self.style.WARNING(
                        f"  [KEEP]   {len(dist_only)} queries (dist only)"
                    )
                )

    def _interactive_backend_select(self, update_mode=False, dist_db_path=None):
        """Show interactive multi-select for backend configurations."""
        all_backends = list(
            SparqlEndpointConfiguration.objects.all().order_by("sort_key", "name")
        )

        if not all_backends:
            self.stdout.write(self.style.WARNING("No backends found in the database."))
            return []

        # Get existing names from dist db for status display
        existing_names = set()
        if update_mode and dist_db_path:
            conn = sqlite3.connect(dist_db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM api_sparqlendpointconfiguration")
            existing_names = {row["name"] for row in cursor.fetchall()}
            conn.close()

        choices = []
        for backend in all_backends:
            if update_mode:
                status = "[UPDATE]" if backend.name in existing_names else "[ADD]"
                title = f"{status} {backend.slug} ({backend.name})"
            else:
                title = f"{backend.slug} ({backend.name})"
            choices.append(
                questionary.Choice(
                    title=title,
                    value=backend,
                    checked=True,
                )
            )

        self.stdout.write(
            "\nSelect backends to export (space to toggle, enter to confirm):\n"
        )

        selected = questionary.checkbox(
            "Backends:",
            choices=choices,
        ).ask()

        return selected

    def _interactive_example_select(self, update_mode=False, dist_db_path=None):
        """Show interactive multi-select for query examples."""
        all_examples = list(
            QueryExample.objects.all()
            .select_related("backend")
            .order_by("backend__sort_key", "sort_key", "name")
        )

        if not all_examples:
            self.stdout.write(self.style.WARNING("No examples found in the database."))
            return []

        # Get existing keys from dist db for status display
        existing_keys = set()
        if update_mode and dist_db_path:
            conn = sqlite3.connect(dist_db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            cursor.execute(
                "SELECT e.name, b.name as backend_name "
                "FROM api_queryexample e "
                "JOIN api_sparqlendpointconfiguration b ON e.backend_id = b.id"
            )
            existing_keys = {
                (row["backend_name"], row["name"]) for row in cursor.fetchall()
            }
            conn.close()

        choices = []
        for example in all_examples:
            if update_mode:
                key = (example.backend.name, example.name)
                status = "[UPDATE]" if key in existing_keys else "[ADD]"
                title = f"{status} {example.name} ({example.backend.slug})"
            else:
                title = f"{example.name} ({example.backend.slug})"
            choices.append(
                questionary.Choice(
                    title=title,
                    value=example,
                    checked=True,
                )
            )

        self.stdout.write(
            "\nSelect examples to export (space to toggle, enter to confirm):\n"
        )

        selected = questionary.checkbox(
            "Examples:",
            choices=choices,
        ).ask()

        return selected

    def _export_backends(self, cursor, records):
        """Export SparqlEndpointConfiguration records (reset mode)."""
        cursor.execute("DELETE FROM api_sparqlendpointconfiguration")
        self.stdout.write("  Cleared existing backends from dist db")

        for backend in records:
            cursor.execute(
                """
                INSERT INTO api_sparqlendpointconfiguration (
                    id, name, engine, slug, is_default, sort_key, url, api_token,
                    prefixes, subject_completion, predicate_completion_context_sensitive,
                    predicate_completion_context_insensitive, object_completion_context_sensitive,
                    object_completion_context_insensitive,
                    values_completion_context_sensitive,
                    values_completion_context_insensitive, hover
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    backend.id,
                    backend.name,
                    backend.engine,
                    backend.slug,
                    backend.is_default,
                    backend.sort_key,
                    backend.url,
                    backend.api_token,
                    backend.prefixes,
                    backend.subject_completion,
                    backend.predicate_completion_context_sensitive,
                    backend.predicate_completion_context_insensitive,
                    backend.object_completion_context_sensitive,
                    backend.object_completion_context_insensitive,
                    backend.values_completion_context_sensitive,
                    backend.values_completion_context_insensitive,
                    backend.hover,
                ),
            )
        self.stdout.write(self.style.SUCCESS(f"  Exported {len(records)} backends"))

    def _upsert_backends(self, cursor, records, delete_mode):
        """Upsert SparqlEndpointConfiguration records (update mode)."""
        # Get existing backends by name
        cursor.execute("SELECT id, name FROM api_sparqlendpointconfiguration")
        existing = {row[1]: row[0] for row in cursor.fetchall()}
        source_names = {r.name for r in records}

        added = 0
        updated = 0

        for backend in records:
            if backend.name in existing:
                # Update existing record
                cursor.execute(
                    """
                    UPDATE api_sparqlendpointconfiguration SET
                        engine = ?, slug = ?, is_default = ?, sort_key = ?, url = ?,
                        api_token = ?, prefixes = ?, subject_completion = ?,
                        predicate_completion_context_sensitive = ?,
                        predicate_completion_context_insensitive = ?,
                        object_completion_context_sensitive = ?,
                        object_completion_context_insensitive = ?,
                        values_completion_context_sensitive = ?,
                        values_completion_context_insensitive = ?,
                        hover = ?
                    WHERE name = ?
                    """,
                    (
                        backend.engine,
                        backend.slug,
                        backend.is_default,
                        backend.sort_key,
                        backend.url,
                        backend.api_token,
                        backend.prefixes,
                        backend.subject_completion,
                        backend.predicate_completion_context_sensitive,
                        backend.predicate_completion_context_insensitive,
                        backend.object_completion_context_sensitive,
                        backend.object_completion_context_insensitive,
                        backend.values_completion_context_sensitive,
                        backend.values_completion_context_insensitive,
                        backend.hover,
                        backend.name,
                    ),
                )
                updated += 1
            else:
                # Insert new record
                cursor.execute(
                    """
                    INSERT INTO api_sparqlendpointconfiguration (
                        id, name, engine, slug, is_default, sort_key, url, api_token,
                        prefixes, subject_completion, predicate_completion_context_sensitive,
                        predicate_completion_context_insensitive, object_completion_context_sensitive,
                        object_completion_context_insensitive,
                        values_completion_context_sensitive,
                        values_completion_context_insensitive, hover
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        backend.id,
                        backend.name,
                        backend.engine,
                        backend.slug,
                        backend.is_default,
                        backend.sort_key,
                        backend.url,
                        backend.api_token,
                        backend.prefixes,
                        backend.subject_completion,
                        backend.predicate_completion_context_sensitive,
                        backend.predicate_completion_context_insensitive,
                        backend.object_completion_context_sensitive,
                        backend.object_completion_context_insensitive,
                        backend.values_completion_context_sensitive,
                        backend.values_completion_context_insensitive,
                        backend.hover,
                    ),
                )
                added += 1

        deleted = 0
        if delete_mode:
            # Delete records not in source
            names_to_delete = set(existing.keys()) - source_names
            if names_to_delete:
                placeholders = ",".join("?" * len(names_to_delete))
                cursor.execute(
                    f"DELETE FROM api_sparqlendpointconfiguration WHERE name IN ({placeholders})",
                    tuple(names_to_delete),
                )
                deleted = cursor.rowcount

        self.stdout.write(
            self.style.SUCCESS(
                f"  Backends: {added} added, {updated} updated"
                + (f", {deleted} deleted" if delete_mode else "")
            )
        )

    def _export_examples(self, cursor, records):
        """Export QueryExample records (reset mode)."""
        cursor.execute("DELETE FROM api_queryexample")
        self.stdout.write("  Cleared existing examples from dist db")

        for example in records:
            cursor.execute(
                """
                INSERT INTO api_queryexample (id, name, query, sort_key, backend_id)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    example.id,
                    example.name,
                    example.query,
                    example.sort_key,
                    example.backend_id,
                ),
            )
        self.stdout.write(self.style.SUCCESS(f"  Exported {len(records)} examples"))

    def _upsert_examples(self, cursor, records, delete_mode):
        """Upsert QueryExample records (update mode)."""
        # Build lookup of dist backend name -> id
        cursor.execute("SELECT id, name FROM api_sparqlendpointconfiguration")
        dist_backend_lookup = {row[1]: row[0] for row in cursor.fetchall()}

        # Get existing examples by (backend_name, example_name)
        cursor.execute(
            "SELECT e.id, e.name, b.name as backend_name "
            "FROM api_queryexample e "
            "JOIN api_sparqlendpointconfiguration b ON e.backend_id = b.id"
        )
        existing = {(row[2], row[1]): row[0] for row in cursor.fetchall()}

        source_keys = set()
        added = 0
        updated = 0
        skipped = 0

        for example in records:
            backend_name = example.backend.name
            if backend_name not in dist_backend_lookup:
                self.stdout.write(
                    self.style.WARNING(
                        f"  Skipping example '{example.name}': backend '{backend_name}' not found in dist db"
                    )
                )
                skipped += 1
                continue

            dist_backend_id = dist_backend_lookup[backend_name]
            key = (backend_name, example.name)
            source_keys.add(key)

            if key in existing:
                # Update existing record
                cursor.execute(
                    """
                    UPDATE api_queryexample SET query = ?, sort_key = ?, backend_id = ?
                    WHERE id = ?
                    """,
                    (example.query, example.sort_key, dist_backend_id, existing[key]),
                )
                updated += 1
            else:
                # Insert new record
                cursor.execute(
                    """
                    INSERT INTO api_queryexample (id, name, query, sort_key, backend_id)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        example.id,
                        example.name,
                        example.query,
                        example.sort_key,
                        dist_backend_id,
                    ),
                )
                added += 1

        deleted = 0
        if delete_mode:
            # Delete examples not in source, but only for backends that exist in source
            source_backend_names = {r.backend.name for r in records}
            for key, example_id in existing.items():
                backend_name, example_name = key
                if backend_name in source_backend_names and key not in source_keys:
                    cursor.execute(
                        "DELETE FROM api_queryexample WHERE id = ?", (example_id,)
                    )
                    deleted += 1

        result_msg = f"  Examples: {added} added, {updated} updated"
        if delete_mode:
            result_msg += f", {deleted} deleted"
        if skipped > 0:
            result_msg += f", {skipped} skipped"
        self.stdout.write(self.style.SUCCESS(result_msg))

    def _export_saved(self, cursor, records):
        """Export SavedQuery records (reset mode)."""
        cursor.execute("DELETE FROM api_savedquery")
        self.stdout.write("  Cleared existing saved queries from dist db")

        for saved in records:
            cursor.execute(
                """
                INSERT INTO api_savedquery (id, content)
                VALUES (?, ?)
                """,
                (saved.id, saved.content),
            )
        self.stdout.write(
            self.style.SUCCESS(f"  Exported {len(records)} saved queries")
        )

    def _upsert_saved(self, cursor, records, delete_mode):
        """Upsert SavedQuery records (update mode)."""
        cursor.execute("SELECT id FROM api_savedquery")
        existing_ids = {row[0] for row in cursor.fetchall()}
        source_ids = {r.id for r in records}

        added = 0
        updated = 0

        for saved in records:
            if saved.id in existing_ids:
                cursor.execute(
                    "UPDATE api_savedquery SET content = ? WHERE id = ?",
                    (saved.content, saved.id),
                )
                updated += 1
            else:
                cursor.execute(
                    "INSERT INTO api_savedquery (id, content) VALUES (?, ?)",
                    (saved.id, saved.content),
                )
                added += 1

        deleted = 0
        if delete_mode:
            ids_to_delete = existing_ids - source_ids
            if ids_to_delete:
                placeholders = ",".join("?" * len(ids_to_delete))
                cursor.execute(
                    f"DELETE FROM api_savedquery WHERE id IN ({placeholders})",
                    tuple(ids_to_delete),
                )
                deleted = cursor.rowcount

        self.stdout.write(
            self.style.SUCCESS(
                f"  Saved queries: {added} added, {updated} updated"
                + (f", {deleted} deleted" if delete_mode else "")
            )
        )
