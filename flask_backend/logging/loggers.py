import os
import logging
import time
import traceback
import json
from contextlib import contextmanager
from pydantic import BaseModel
import numpy as np
from functools import wraps

from flask_backend.settings.config import logger as base_logger

class ModuleLoggerAdapter(logging.LoggerAdapter):
    def process(self, msg, kwargs):
        # Rely on Python's built-in module attribute rather than injecting our own.
        return msg, kwargs

class Logger:
    def __init__(self, name="MTKAdvanced", extra=None, enable_file_logging=True, log_dir="logs", custom_format=True):
        self.extra = extra or {}
        child_logger = base_logger.getChild(name)
        self.logger = ModuleLoggerAdapter(child_logger, self.extra)
        self.logger.logger.propagate = False  # Avoid duplicate logs
        self._setup_handlers(enable_file_logging, log_dir, custom_format)
        self.timers = {}
        self.log_dir = log_dir  # Save log directory for later use

        # Set up a dedicated logger for function calls.
        self.function_logger = logging.getLogger("function_logger")
        self.function_logger.setLevel(self.logger.logger.level)
        # Clear any existing handlers.
        self.function_logger.handlers.clear()
        # Create and add a dedicated file handler.
        function_handler = logging.FileHandler(os.path.join(log_dir, "function_calls.log"), encoding="utf-8")
        function_handler.setLevel(self.logger.logger.level)
        function_formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
        function_handler.setFormatter(function_formatter)
        self.function_logger.addHandler(function_handler)

    def _setup_handlers(self, enable_file_logging, log_dir, custom_format):
        # Determine log level from an environment variable (default to INFO)
        log_level_str = os.getenv("LOG_LEVEL", "INFO").upper()
        numeric_level = getattr(logging, log_level_str, logging.INFO)

        if custom_format:
            # Remove existing handlers from the main logger.
            for handler in self.logger.logger.handlers[:]:
                self.logger.logger.removeHandler(handler)
            console_handler = logging.StreamHandler()
            console_formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
            console_handler.setFormatter(console_formatter)
            self.logger.logger.addHandler(console_handler)
            self.logger.logger.setLevel(numeric_level)
        if enable_file_logging:
            os.makedirs(log_dir, exist_ok=True)
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            file_handler = logging.FileHandler(f"{log_dir}/app_logger_{timestamp}.log", encoding="utf-8")
            file_handler.setLevel(numeric_level)
            file_formatter = logging.Formatter("%(asctime)s | %(levelname)-8s | %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
            file_handler.setFormatter(file_formatter)
            self.logger.logger.addHandler(file_handler)

    @staticmethod
    @contextmanager
    def logged_timer_context(operation: str, logger, level: str = "info", debug: bool = False):
        """
        Context manager that logs start/end of an operation with timing and optional debug/error handling.
        
        Args:
            operation (str): Description of the operation being timed/logged.
            logger: Logger object with .info(), .debug(), .error(), etc.
            level (str): Logging level for start and end messages ("info" or "debug").
            debug (bool): If True, will also catch and log exceptions with traceback.
        """
        start_time = time.time()
        log_func = getattr(logger, level.lower(), logger.info)
        log_func(f"Started: {operation}")

        try:
            yield
        except Exception as e:
            if debug:
                logger.error(f"Error in {operation}: {str(e)}\n{traceback.format_exc()}", exc_info=True)
            raise
        finally:
            elapsed = time.time() - start_time
            log_func(f"Finished: {operation} (elapsed: {elapsed:.4f}s)")

    @contextmanager
    def debug_context(self, operation: str):
        """
        Context manager for debugging a block of code. Logs at debug level and catches exceptions.
        """
        with Logger.logged_timer_context(operation, self.logger, level="debug", debug=True):
            yield

    @contextmanager
    def timer_context(self, operation: str, level: str = "info"):
        """
        General-purpose timer context manager that logs start and finish messages at the specified level.
        """
        with Logger.logged_timer_context(operation, self.logger, level=level, debug=False):
            yield

    def log_function(self, func):
        """Decorator to log function entry, exit, parameters, and elapsed time to a dedicated function log file."""
        @wraps(func)
        def wrapper(*args, **kwargs):
            func_name = func.__name__
            self.function_logger.info(f"+{'-'*60}")
            self.function_logger.info(f"| STARTING: {func_name} with args={args} kwargs={kwargs}")
            self._start_timer(func_name)
            result = func(*args, **kwargs)
            elapsed = self._end_timer(func_name)
            self.function_logger.info(f"| COMPLETED: {func_name} in {elapsed:.4f} seconds with result={result}")
            self.function_logger.info(f"+{'-'*60}")
            return result
        return wrapper

    def _start_timer(self, name):
        self.timers[name] = time.time()

    def _end_timer(self, name):
        if name in self.timers:
            elapsed = time.time() - self.timers[name]
            del self.timers[name]
            return elapsed
        return None

    def log_step(self, step_name, message, data=None, level=logging.INFO):
        """Log a step or milestone in the code, ensuring JSON serialization of Pydantic models."""
        try:
            if isinstance(data, BaseModel):
                data_str = data.model_dump_json(indent=2)
            elif isinstance(data, list) and all(isinstance(i, BaseModel) for i in data):
                data_str = json.dumps([i.model_dump() for i in data], indent=2)
            elif isinstance(data, dict) and all(isinstance(v, BaseModel) for v in data.values()):
                data_str = json.dumps({k: v.model_dump() for k, v in data.items()}, indent=2)
            else:
                data_str = json.dumps(data, default=str, indent=2) if data else ""
        except (TypeError, ValueError) as e:
            data_str = f"[Failed to serialize data: {e}]"

        if data_str:
            log_message = f"{step_name} - {message}\nData: {data_str}"
        else:
            log_message = f"{step_name} - {message}"

        self.logger.log(level, log_message)

    @staticmethod
    def visualize_matrix(matrix, threshold=0):
        """
        Visualize a numpy matrix in ASCII format.
        """
        if matrix.ndim <= 2:
            # 1D or 2D matrices
            if matrix.ndim == 1:
                matrix = matrix.reshape(1, -1)
            rows = []
            for row in matrix:
                row_str = " ".join(["#" if val > threshold else "." for val in row])
                rows.append(row_str)
            return "\n".join(rows)
        else:
            return f"Matrix shape: {matrix.shape}, non-zero: {np.count_nonzero(matrix)}"

    def validate(self, condition, message, data=None):
        """Log a validation result."""
        result = bool(condition)
        status = "PASS" if result else "FAIL"
        level = logging.INFO if result else logging.ERROR
        data_str = json.dumps(data, default=str, indent=2) if data else ""
        self.logger.log(level, f"VALIDATION {status}: {message} {data_str}")
        return result

    def debug(self, message, *args, data=None):
        if data is not None:
            data_str = json.dumps(data, default=str, indent=2)
            message = f"{message}\nData: {data_str}"
        self.logger.debug(message, *args)

    def error(self, message, *args, data=None, exc_info=False):
        if data is not None:
            data_str = json.dumps(data, default=str, indent=2)
            message = f"{message}\nData: {data_str}"
        self.logger.error(message, *args, exc_info=exc_info)

    def info(self, message, *args, data=None):
        if data is not None:
            data_str = json.dumps(data, default=str, indent=2)
            message = f"{message}\nData: {data_str}"
        self.logger.info(message, *args)

    def warning(self, message, *args, data=None):
        if data is not None:
            data_str = json.dumps(data, default=str, indent=2)
            message = f"{message}\nData: {data_str}"
        self.logger.warning(message, *args)

    @staticmethod
    def log_execution(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            start = time.perf_counter()
            result = func(*args, **kwargs)
            end = time.perf_counter()
            elapsed = end - start
            logging.info(f"| COMPLETED: {func.__name__} in {elapsed:.4f} seconds with result={result}")
            return result
        return wrapper

# Global instance for use throughout your app.
logger = Logger(log_dir="flask_backend/log_utils/logs")
