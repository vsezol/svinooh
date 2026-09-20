import re

PICTOGRAPHS = re.compile("[\U0001f000-\U0001faff\U00002600-\U000027bf\U0001f1e6-\U0001f1ff⬀-⯿️‍]+")


def plain(said: str) -> str:
    return PICTOGRAPHS.sub("", said)
