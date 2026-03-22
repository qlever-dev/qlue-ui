"""
Import data from the distribution database to the development/production database.

This command imports selected models from the distribution database (db.sqlite3.dist)
into your current working database. Use this to reset your dev environment or to
initialize a fresh production deployment.

USAGE:
    python manage.py import_from_dist [options]

OPTIONS:
    --backends      Import SparqlEndpointConfiguration records
    --examples      Import QueryExample records
    --saved         Import SavedQuery records (usually NOT recommended)
    --all           Import all models
    --select        Interactively select which records to import (use with --backends or --examples)
    --update        Upsert mode: add/update records without deleting others (incremental sync)
    --delete        With --update: also delete records that only exist in destination
    --dry-run       Show what would be imported without making changes
    --force         Skip confirmation prompt

EXAMPLES:
    # Preview what backends would be imported
    python manage.py import_from_dist --backends --dry-run

    # Import all backends (RESET mode: wipe and replace)
    python manage.py import_from_dist --backends

    # Incremental update (upsert, keeps local-only records)
    python manage.py import_from_dist --backends --update

    # Full sync (upsert + delete records not in source)
    python manage.py import_from_dist --backends --update --delete

    # Interactively select which backends to import
    python manage.py import_from_dist --backends --select

    # Selective update with interactive picker
    python manage.py import_from_dist --backends --select --update

    # Reset backends and examples together
    python manage.py import_from_dist --backends --examples

    # Full reset to distribution state (use with caution)
    python manage.py import_from_dist --all

WARNINGS:
    - Without --update: DELETES and REPLACES data in your current database
    - With --update: Incrementally adds/updates records (safer)
    - With --update --delete: Full sync including deletions
    - If importing examples, the referenced backends must exist (import them first
      or together with --backends --examples)
    - SavedQuery contains user-generated content - importing will delete existing shares
    - Always use --dry-run first to preview changes

DATA FLOW:
    [db.sqlite3.dist] --import--> [current db.sqlite3]
"""

import sqlite3
from pathlib import Path

import questionary
from django.core.management.base import BaseCommand, CommandError
from django.conf import settings
from django.db import transaction

from api.models import SparqlEndpointConfiguration, QueryExample, SavedQuery


class Command(BaseCommand):
    help = (
        "Import data from distribution database (db.sqlite3.dist) to current database"
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--backends",
            action="store_true",
            help="Import SparqlEndpointConfiguration records",
        )
        parser.add_argument(
            "--examples",
            action="store_true",
            help="Import QueryExample records",
        )
        parser.add_argument(
            "--saved",
            action="store_true",
            help="Import SavedQuery records (usually not recommended)",
        )
        parser.add_argument(
            "--all",
            action="store_true",
            help="Import all models",
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
            help="Show what would be imported without making changes",
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
                "Ensure db.sqlite3.dist exists in the project root."
            )

        # Determine which models to import
        import_backends = options["backends"] or options["all"]
        import_examples = options["examples"] or options["all"]
        import_saved = options["saved"] or options["all"]
        interactive_select = options["select"]
        update_mode = options["update"]
        delete_mode = options["delete"]

        # Validate flag combinations
        if delete_mode and not update_mode:
            raise CommandError(
                "--delete requires --update.\n"
                "Use --update --delete for full sync with deletions."
            )

        if interactive_select and not any([import_backends, import_examples]):
            raise CommandError(
                "--select requires --backends or --examples.\n"
                "Example: --backends --select"
            )

        if not any([import_backends, import_examples, import_saved]):
            raise CommandError(
                "No models selected for import.\n"
                "Use --backends, --examples, --saved, or --all"
            )

        # Connect to distribution database and read data
        conn = sqlite3.connect(dist_db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        imports = []

        try:
            if import_backends:
                cursor.execute(
                    "SELECT * FROM api_sparqlendpointconfiguration ORDER BY sort_key, name"
                )
                backends = cursor.fetchall()
                if interactive_select:
                    backends = self._interactive_backend_select(backends, update_mode)
                    if backends is None:
                        self.stdout.write(self.style.WARNING("Selection cancelled."))
                        return
                if backends:
                    imports.append(("SparqlEndpointConfiguration", list(backends)))

            if import_examples:
                cursor.execute(
                    "SELECT e.*, b.slug as backend_slug, b.name as backend_name FROM api_queryexample e "
                    "JOIN api_sparqlendpointconfiguration b ON e.backend_id = b.id "
                    "ORDER BY b.sort_key, e.sort_key, e.name"
                )
                examples = cursor.fetchall()
                if interactive_select:
                    examples = self._interactive_example_select(examples, update_mode)
                    if examples is None:
                        self.stdout.write(self.style.WARNING("Selection cancelled."))
                        return
                if examples:
                    imports.append(("QueryExample", list(examples)))

            if import_saved:
                cursor.execute("SELECT * FROM api_savedquery")
                saved = cursor.fetchall()
                imports.append(("SavedQuery", list(saved)))

        finally:
            conn.close()

        if not imports:
            self.stdout.write(self.style.WARNING("No data selected for import."))
            return

        # Show current state
        self.stdout.write("\n" + "=" * 60)
        if update_mode:
            mode_str = "UPDATE" if not delete_mode else "SYNC"
            self.stdout.write(
                self.style.WARNING(
                    f"IMPORT FROM DISTRIBUTION DATABASE ({mode_str} MODE)"
                )
            )
        else:
            self.stdout.write(
                self.style.WARNING("IMPORT FROM DISTRIBUTION DATABASE (RESET MODE)")
            )
        self.stdout.write("=" * 60)
        self.stdout.write(f"\nSource: {dist_db_path}\n")

        if update_mode:
            self._show_update_preview(imports, delete_mode)
        else:
            self._show_reset_preview(
                imports, import_backends, import_examples, import_saved
            )

        # Check for FK issues
        if import_examples and not import_backends:
            self.stdout.write("")
            self.stdout.write(
                self.style.WARNING(
                    "NOTE: Importing examples without backends. Ensure backends with "
                    "matching names exist in your current database, or import them together."
                )
            )

        if options["dry_run"]:
            self.stdout.write(self.style.SUCCESS("\n[DRY RUN] No changes made."))
            return

        # Confirmation
        self.stdout.write("")
        if update_mode:
            if delete_mode:
                self.stdout.write(
                    self.style.ERROR(
                        "WARNING: This will ADD, UPDATE, and DELETE records!"
                    )
                )
            else:
                self.stdout.write(
                    self.style.WARNING(
                        "This will ADD and UPDATE records (existing local-only records will be kept)."
                    )
                )
        else:
            self.stdout.write(
                self.style.ERROR(
                    "WARNING: This will DELETE existing data and replace it!"
                )
            )

        if import_saved:
            self.stdout.write(
                self.style.ERROR(
                    "WARNING: You are importing SavedQuery - existing user shares will be affected!"
                )
            )

        if not options["force"]:
            confirm = input("\nType 'yes' to confirm: ")
            if confirm.lower() != "yes":
                self.stdout.write(self.style.WARNING("Import cancelled."))
                return

        # Perform the import within a transaction
        try:
            with transaction.atomic():
                for model_name, records in imports:
                    if model_name == "SparqlEndpointConfiguration":
                        if update_mode:
                            self._upsert_backends(records, delete_mode)
                        else:
                            self._import_backends(records)
                    elif model_name == "QueryExample":
                        if update_mode:
                            self._upsert_examples(records, delete_mode)
                        else:
                            self._import_examples(records)
                    elif model_name == "SavedQuery":
                        if update_mode:
                            self._upsert_saved(records, delete_mode)
                        else:
                            self._import_saved(records)

            self.stdout.write(self.style.SUCCESS("\nImport completed successfully!"))

        except Exception as e:
            raise CommandError(f"Import failed: {e}")

    def _show_reset_preview(
        self, imports, import_backends, import_examples, import_saved
    ):
        """Show preview for reset mode (wipe and replace)."""
        # Show what will be deleted
        self.stdout.write("Current data that will be DELETED:")
        if import_backends:
            current_backends = SparqlEndpointConfiguration.objects.count()
            self.stdout.write(
                f"  - SparqlEndpointConfiguration: {current_backends} records"
            )
        if import_examples:
            current_examples = QueryExample.objects.count()
            self.stdout.write(f"  - QueryExample: {current_examples} records")
        if import_saved:
            current_saved = SavedQuery.objects.count()
            self.stdout.write(f"  - SavedQuery: {current_saved} records")

        # Show what will be imported
        self.stdout.write("\nData to import from dist db:")
        for model_name, records in imports:
            self.stdout.write(f"  - {model_name}: {len(records)} records")
            if model_name == "SparqlEndpointConfiguration":
                for r in records:
                    self.stdout.write(f"      * {r['slug']} ({r['name']})")
            elif model_name == "QueryExample":
                for r in records:
                    backend_info = (
                        r["backend_slug"]
                        if r["backend_slug"]
                        else f"backend_id: {r['backend_id']}"
                    )
                    self.stdout.write(f"      * {r['name']} ({backend_info})")
            elif model_name == "SavedQuery":
                for r in list(records)[:5]:
                    self.stdout.write(f"      * {r['id']}")
                if len(records) > 5:
                    self.stdout.write(f"      * ... and {len(records) - 5} more")

    def _show_update_preview(self, imports, delete_mode):
        """Show preview for update mode with [ADD], [UPDATE], [KEEP], [DELETE] labels."""
        for model_name, records in imports:
            self.stdout.write(f"\n{model_name}:")

            if model_name == "SparqlEndpointConfiguration":
                self._show_backend_update_preview(records, delete_mode)
            elif model_name == "QueryExample":
                self._show_example_update_preview(records, delete_mode)
            elif model_name == "SavedQuery":
                self._show_saved_update_preview(records, delete_mode)

    def _show_backend_update_preview(self, source_records, delete_mode):
        """Show update preview for backends."""
        # Build lookup of existing backends by name
        existing = {b.name: b for b in SparqlEndpointConfiguration.objects.all()}
        source_names = {r["name"] for r in source_records}

        # Categorize records
        for r in source_records:
            name = r["name"]
            if name in existing:
                self.stdout.write(f"  [UPDATE] {r['slug']} ({name})")
            else:
                self.stdout.write(
                    self.style.SUCCESS(f"  [ADD]    {r['slug']} ({name})")
                )

        # Show local-only records
        for name, backend in existing.items():
            if name not in source_names:
                if delete_mode:
                    self.stdout.write(
                        self.style.ERROR(f"  [DELETE] {backend.slug} ({name})")
                    )
                else:
                    self.stdout.write(
                        self.style.WARNING(
                            f"  [KEEP]   {backend.slug} ({name}) (local only)"
                        )
                    )

    def _show_example_update_preview(self, source_records, delete_mode):
        """Show update preview for examples."""
        # Build lookup of existing examples by (backend_name, example_name)
        existing = {}
        for e in QueryExample.objects.select_related("backend").all():
            key = (e.backend.name, e.name)
            existing[key] = e

        source_keys = {(r["backend_name"], r["name"]) for r in source_records}

        # Categorize records
        for r in source_records:
            key = (r["backend_name"], r["name"])
            backend_slug = r["backend_slug"] if r["backend_slug"] else r["backend_name"]
            if key in existing:
                self.stdout.write(f"  [UPDATE] {r['name']} ({backend_slug})")
            else:
                self.stdout.write(
                    self.style.SUCCESS(f"  [ADD]    {r['name']} ({backend_slug})")
                )

        # Show local-only records
        for key, example in existing.items():
            if key not in source_keys:
                if delete_mode:
                    self.stdout.write(
                        self.style.ERROR(
                            f"  [DELETE] {example.name} ({example.backend.slug})"
                        )
                    )
                else:
                    self.stdout.write(
                        self.style.WARNING(
                            f"  [KEEP]   {example.name} ({example.backend.slug}) (local only)"
                        )
                    )

    def _show_saved_update_preview(self, source_records, delete_mode):
        """Show update preview for saved queries."""
        existing_ids = set(SavedQuery.objects.values_list("id", flat=True))
        source_ids = {r["id"] for r in source_records}

        # Categorize records
        add_count = 0
        update_count = 0
        for r in source_records:
            if r["id"] in existing_ids:
                update_count += 1
            else:
                add_count += 1

        if add_count > 0:
            self.stdout.write(self.style.SUCCESS(f"  [ADD]    {add_count} queries"))
        if update_count > 0:
            self.stdout.write(f"  [UPDATE] {update_count} queries")

        # Show local-only count
        local_only = existing_ids - source_ids
        if local_only:
            if delete_mode:
                self.stdout.write(
                    self.style.ERROR(f"  [DELETE] {len(local_only)} queries")
                )
            else:
                self.stdout.write(
                    self.style.WARNING(
                        f"  [KEEP]   {len(local_only)} queries (local only)"
                    )
                )

    def _interactive_backend_select(self, all_backends, update_mode=False):
        """Show interactive multi-select for backend configurations from dist db."""
        if not all_backends:
            self.stdout.write(
                self.style.WARNING("No backends found in distribution database.")
            )
            return []

        existing = {b.name for b in SparqlEndpointConfiguration.objects.all()}

        choices = []
        for backend in all_backends:
            name = backend["name"]
            status = "[UPDATE]" if name in existing else "[ADD]"
            if update_mode:
                title = f"{status} {backend['slug']} ({name})"
            else:
                title = f"{backend['slug']} ({name})"
            choices.append(
                questionary.Choice(
                    title=title,
                    value=backend,
                    checked=True,
                )
            )

        self.stdout.write(
            "\nSelect backends to import (space to toggle, enter to confirm):\n"
        )

        selected = questionary.checkbox(
            "Backends:",
            choices=choices,
        ).ask()

        return selected

    def _interactive_example_select(self, all_examples, update_mode=False):
        """Show interactive multi-select for query examples from dist db."""
        if not all_examples:
            self.stdout.write(
                self.style.WARNING("No examples found in distribution database.")
            )
            return []

        existing = set()
        for e in QueryExample.objects.select_related("backend").all():
            existing.add((e.backend.name, e.name))

        choices = []
        for example in all_examples:
            key = (example["backend_name"], example["name"])
            status = "[UPDATE]" if key in existing else "[ADD]"
            if update_mode:
                title = f"{status} {example['name']} ({example['backend_slug']})"
            else:
                title = f"{example['name']} ({example['backend_slug']})"
            choices.append(
                questionary.Choice(
                    title=title,
                    value=example,
                    checked=True,
                )
            )

        self.stdout.write(
            "\nSelect examples to import (space to toggle, enter to confirm):\n"
        )

        selected = questionary.checkbox(
            "Examples:",
            choices=choices,
        ).ask()

        return selected

    def _import_backends(self, records):
        """Import SparqlEndpointConfiguration records (reset mode)."""
        SparqlEndpointConfiguration.objects.all().delete()
        self.stdout.write("  Cleared existing backends")

        for row in records:
            SparqlEndpointConfiguration.objects.create(
                id=row["id"],
                name=row["name"],
                engine=row["engine"],
                slug=row["slug"],
                is_default=row["is_default"],
                sort_key=row["sort_key"],
                url=row["url"],
                api_token=row["api_token"],
                prefixes=row["prefixes"],
                subject_completion=row["subject_completion"],
                predicate_completion_context_sensitive=row[
                    "predicate_completion_context_sensitive"
                ],
                predicate_completion_context_insensitive=row[
                    "predicate_completion_context_insensitive"
                ],
                object_completion_context_sensitive=row[
                    "object_completion_context_sensitive"
                ],
                object_completion_context_insensitive=row[
                    "object_completion_context_insensitive"
                ],
                values_completion_context_sensitive=row[
                    "values_completion_context_sensitive"
                ],
                values_completion_context_insensitive=row[
                    "values_completion_context_insensitive"
                ],
                hover=row["hover"],
            )
        self.stdout.write(self.style.SUCCESS(f"  Imported {len(records)} backends"))

    def _upsert_backends(self, records, delete_mode):
        """Upsert SparqlEndpointConfiguration records (update mode)."""
        source_names = {r["name"] for r in records}
        added = 0
        updated = 0

        for row in records:
            defaults = {
                "engine": row["engine"],
                "slug": row["slug"],
                "is_default": row["is_default"],
                "sort_key": row["sort_key"],
                "url": row["url"],
                "api_token": row["api_token"],
                "prefixes": row["prefixes"],
                "subject_completion": row["subject_completion"],
                "predicate_completion_context_sensitive": row[
                    "predicate_completion_context_sensitive"
                ],
                "predicate_completion_context_insensitive": row[
                    "predicate_completion_context_insensitive"
                ],
                "object_completion_context_sensitive": row[
                    "object_completion_context_sensitive"
                ],
                "object_completion_context_insensitive": row[
                    "object_completion_context_insensitive"
                ],
                "values_completion_context_sensitive": row[
                    "values_completion_context_sensitive"
                ],
                "values_completion_context_insensitive": row[
                    "values_completion_context_insensitive"
                ],
                "hover": row["hover"],
            }
            _, created = SparqlEndpointConfiguration.objects.update_or_create(
                name=row["name"],
                defaults=defaults,
            )
            if created:
                added += 1
            else:
                updated += 1

        deleted = 0
        if delete_mode:
            deleted, _ = SparqlEndpointConfiguration.objects.exclude(
                name__in=source_names
            ).delete()

        self.stdout.write(
            self.style.SUCCESS(
                f"  Backends: {added} added, {updated} updated"
                + (f", {deleted} deleted" if delete_mode else "")
            )
        )

    def _import_examples(self, records):
        """Import QueryExample records (reset mode)."""
        QueryExample.objects.all().delete()
        self.stdout.write("  Cleared existing examples")

        for row in records:
            QueryExample.objects.create(
                id=row["id"],
                name=row["name"],
                query=row["query"],
                sort_key=row["sort_key"],
                backend_id=row["backend_id"],
            )
        self.stdout.write(self.style.SUCCESS(f"  Imported {len(records)} examples"))

    def _upsert_examples(self, records, delete_mode):
        """Upsert QueryExample records (update mode)."""
        # Build lookup of backend name -> backend instance
        backend_lookup = {b.name: b for b in SparqlEndpointConfiguration.objects.all()}

        source_keys = set()
        added = 0
        updated = 0
        skipped = 0

        for row in records:
            backend_name = row["backend_name"]
            if backend_name not in backend_lookup:
                self.stdout.write(
                    self.style.WARNING(
                        f"  Skipping example '{row['name']}': backend '{backend_name}' not found"
                    )
                )
                skipped += 1
                continue

            backend = backend_lookup[backend_name]
            source_keys.add((backend.id, row["name"]))

            defaults = {
                "query": row["query"],
                "sort_key": row["sort_key"],
            }
            _, created = QueryExample.objects.update_or_create(
                backend=backend,
                name=row["name"],
                defaults=defaults,
            )
            if created:
                added += 1
            else:
                updated += 1

        deleted = 0
        if delete_mode:
            # Delete examples not in source, but only for backends that exist in source
            existing_backend_names = {r["backend_name"] for r in records}
            backends_in_source = SparqlEndpointConfiguration.objects.filter(
                name__in=existing_backend_names
            )
            for backend in backends_in_source:
                source_example_names = {
                    r["name"] for r in records if r["backend_name"] == backend.name
                }
                del_count, _ = (
                    QueryExample.objects.filter(backend=backend)
                    .exclude(name__in=source_example_names)
                    .delete()
                )
                deleted += del_count

        result_msg = f"  Examples: {added} added, {updated} updated"
        if delete_mode:
            result_msg += f", {deleted} deleted"
        if skipped > 0:
            result_msg += f", {skipped} skipped"
        self.stdout.write(self.style.SUCCESS(result_msg))

    def _import_saved(self, records):
        """Import SavedQuery records (reset mode)."""
        SavedQuery.objects.all().delete()
        self.stdout.write("  Cleared existing saved queries")

        for row in records:
            # Bypass the auto-ID generation by directly setting id
            SavedQuery.objects.create(
                id=row["id"],
                content=row["content"],
            )
        self.stdout.write(
            self.style.SUCCESS(f"  Imported {len(records)} saved queries")
        )

    def _upsert_saved(self, records, delete_mode):
        """Upsert SavedQuery records (update mode)."""
        source_ids = {r["id"] for r in records}
        added = 0
        updated = 0

        for row in records:
            defaults = {
                "content": row["content"],
            }
            _, created = SavedQuery.objects.update_or_create(
                id=row["id"],
                defaults=defaults,
            )
            if created:
                added += 1
            else:
                updated += 1

        deleted = 0
        if delete_mode:
            deleted, _ = SavedQuery.objects.exclude(id__in=source_ids).delete()

        self.stdout.write(
            self.style.SUCCESS(
                f"  Saved queries: {added} added, {updated} updated"
                + (f", {deleted} deleted" if delete_mode else "")
            )
        )
