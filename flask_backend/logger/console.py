import logging


def quiet_console(logger):
    """Keep file handlers untouched (FileHandler subclasses StreamHandler!) and keep
    console handlers, but only for WARNING+ so routine chatter stays out of the
    terminal while startup failures (broker/version errors) remain visible."""
    for h in logger.handlers:
        if isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler):
            h.setLevel(logging.WARNING)
