"""Public errors contain deliberately bounded, operator-authored messages only."""


class InferenceError(Exception):
    def __init__(self, code, message, stage, model=None, retryable=False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.stage = stage
        self.model = model
        self.retryable = retryable

    def as_dict(self):
        result = {
            "code": self.code, "message": self.message,
            "stage": self.stage, "retryable": self.retryable,
        }
        # The API's optional model field names NER models, not ASR.
        if self.model in {"phobert", "xlmr"}:
            result["model"] = self.model
        return result
