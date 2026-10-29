"""Fail closed when the isolated server runtime cannot accept a job."""

EXECUTION_ERROR_CODE = "execution_disabled"
EXECUTION_DISABLED_MESSAGE = (
    "Изолированный Python недоступен. Повторите запуск после восстановления раннера."
)
