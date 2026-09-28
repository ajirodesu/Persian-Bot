# Cactus Needle 3 service image.
# The model weights are downloaded at BUILD time by the official Needle
# fetch flow (never committed to the bot repo).
FROM python:3.12-slim

WORKDIR /srv/needle-service
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Pre-fetch the base Needle 3 engine + weights so the service starts fast.
# Override NEEDLE_WEIGHTS_PATH when deploying a fine-tuned .cact file.
RUN python -c "from needle.agent import fetch; fetch.fetch_library(fetch.engine_version(3), fetch.cache_dir(3), generation=3); fetch.fetch_weights(3)"

COPY app.py ./

ENV NEEDLE_HOST=0.0.0.0 NEEDLE_PORT=8787 NEEDLE_GENERATION=3
EXPOSE 8787
CMD ["python", "app.py"]
