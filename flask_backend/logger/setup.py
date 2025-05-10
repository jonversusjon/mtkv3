import os
import logging
import logging.config
import yaml
from celery import current_task

class TaskContextFilter(logging.Filter):
    def filter(self, record):
        record.task_id = getattr(current_task, 'request', {}).get('id', 'no-task')
        return True

def setup_logging(config_path=None):
    if config_path is None:
        config_path = os.path.join(os.path.dirname(__file__), "config.yaml")

    with open(config_path, "r") as f:
        cfg = yaml.safe_load(f)
    logging.config.dictConfig(cfg)

