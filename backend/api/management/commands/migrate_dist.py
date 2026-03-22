"""
Run migrations on the distribution database.

This command runs Django migrations on the distribution database (db.sqlite3.dist)
instead of the development database. This is useful for keeping the distribution
database schema up to date without affecting your development database.

USAGE:
    python manage.py migrate_dist [options]

OPTIONS:
    --dry-run       Show what migrations would be applied without running them
    --list          Show list of migrations and their status

EXAMPLES:
    # Run all pending migrations on the dist database
    python manage.py migrate_dist

    # Preview which migrations would be applied
    python manage.py migrate_dist --dry-run

    # Show migration status for the dist database
    python manage.py migrate_dist --list

DATA FLOW:
    [migrations] --apply--> [db.sqlite3.dist]
"""

from pathlib import Path

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.conf import settings
from django.db import connections


class Command(BaseCommand):
    help = "Run migrations on the distribution database (db.sqlite3.dist)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what migrations would be applied without running them",
        )
        parser.add_argument(
            "--list",
            action="store_true",
            help="Show list of migrations and their status",
        )

    def handle(self, *args, **options):
        dist_db_path = Path(settings.BASE_DIR).parent / "db.sqlite3.dist"

        if not dist_db_path.exists():
            raise CommandError(
                f"Distribution database not found at {dist_db_path}\n"
                "Create it first by copying your dev database:\n"
                "  cp backend/db.sqlite3 db.sqlite3.dist"
            )

        # Add the distribution database as a temporary database alias
        # Copy from default to get all required settings, then override NAME
        settings.DATABASES["dist"] = {
            **settings.DATABASES["default"],
            "NAME": dist_db_path,
        }

        self.stdout.write("\n" + "=" * 60)
        self.stdout.write(self.style.WARNING("MIGRATE DISTRIBUTION DATABASE"))
        self.stdout.write("=" * 60)
        self.stdout.write(f"\nTarget: {dist_db_path}\n")

        try:
            if options["list"]:
                self.stdout.write("Migration status:\n")
                call_command("showmigrations", database="dist", stdout=self.stdout)
            elif options["dry_run"]:
                self.stdout.write("Migrations that would be applied:\n")
                call_command("migrate", database="dist", plan=True, stdout=self.stdout)
            else:
                self.stdout.write("Running migrations...\n")
                call_command("migrate", database="dist", stdout=self.stdout)
                self.stdout.write(
                    self.style.SUCCESS("\nMigrations applied successfully!")
                )
        finally:
            # Clean up: close the connection if it was opened and remove the alias
            try:
                connections["dist"].close()
            except Exception:
                pass
            del settings.DATABASES["dist"]
