from flask_backend.app import create_app
from flask_backend.celery_app import celery_init_app

from celery.signals import after_setup_logger, after_setup_task_logger
from flask_backend.logger.console import quiet_console


# Build the Flask app (this reads your ENV vars, including CELERY_BROKER_URL)
flask_app = create_app()
celery = celery_init_app(flask_app)

# Grab the Celery instance that create_app() already set up.
celery = flask_app.extensions["celery"]

# Import tasks so that Celery can auto-discover them.
import flask_backend.celery_tasks  # noqa


@after_setup_logger.connect
def quiet_console_handler(logger, **kwargs):
    quiet_console(logger)


@after_setup_task_logger.connect
def quiet_task_console_handler(logger, **kwargs):
    quiet_console(logger)
