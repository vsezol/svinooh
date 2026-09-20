from dataclasses import dataclass

MIN_ANSWERS = 2
MAX_ANSWERS = 4


@dataclass(frozen=True)
class Choice:
    header: str
    question: str
    options: tuple[str, ...]

    @property
    def is_answerable(self) -> bool:
        return MIN_ANSWERS <= len(self.options) <= MAX_ANSWERS and all(
            option.strip() for option in self.options
        )
