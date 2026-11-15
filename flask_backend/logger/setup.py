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

    # File handlers use repo-root-relative paths. Anchor them to the repository
    # (not the process cwd) and create their directories, so a clean checkout
    # or container can start without pre-existing log directories.
    repo_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    for handler in cfg.get("handlers", {}).values():
        filename = handler.get("filename")
        if filename:
            if not os.path.isabs(filename):
                filename = os.path.join(repo_root, filename)
                handler["filename"] = filename
            os.makedirs(os.path.dirname(filename), exist_ok=True)

    logging.config.dictConfig(cfg)

