# celery_app.py
import logging
from celery import Celery, Task
from flask_backend.logger.setup import setup_logging

def celery_init_app(app):
    setup_logging()

    class FlaskTask(Task):
        def __call__(self, *args, **kwargs):
            with app.app_context():
                return self.run(*args, **kwargs)

    class ContextTask(FlaskTask):
        abstract = True

    celery_app = Celery(app.import_name, include=["flask_backend.celery_tasks"])
    celery_app.conf.update(
        broker_url=app.config["CELERY_BROKER_URL"],
        result_backend=app.config["CELERY_RESULT_BACKEND"],
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        task_ignore_result=False,
        worker_hijack_root_logger=False,
        worker_redirect_stdouts=False,
    )

    celery_app.Task = ContextTask
    app.extensions["celery"] = celery_app

    logger = logging.getLogger("flask_backend.celery")
    logger.info("Celery initialized")

    return celery_app
