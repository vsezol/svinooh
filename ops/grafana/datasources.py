#!/usr/bin/env python3
"""The datasources, one JSON object per line, for apply.sh to POST.

The uids are pinned by hand: the dashboards in ./dashboards reference them, and
a Grafana-generated uid only exists in the instance that happened to create it.
"""
import json

PROMETHEUS = 'prometheus'
LOKI = 'loki'
TEMPO = 'tempo'

SERVICE_TAGS = [{'key': 'service.name', 'value': 'app'}]

DATASOURCES = [
    {
        'name': 'Prometheus',
        'uid': PROMETHEUS,
        'type': 'prometheus',
        'access': 'proxy',
        'url': 'http://prometheus.railway.internal:9090',
        'isDefault': True,
    },
    {
        'name': 'Loki',
        'uid': LOKI,
        'type': 'loki',
        'access': 'proxy',
        'url': 'http://loki.railway.internal:3100',
        'jsonData': {
            # Every log line written inside a traced request carries
            # trace_id=<id> (see LokiLogger) — this turns it into a link
            # straight to that trace in Tempo.
            'derivedFields': [
                {
                    'name': 'TraceID',
                    'matcherType': 'regex',
                    'matcherRegex': r'trace_id=([0-9a-f]{32})',
                    'url': '${__value.raw}',
                    'datasourceUid': TEMPO,
                    'urlDisplayLabel': 'View trace',
                }
            ]
        },
    },
    {
        'name': 'Tempo',
        'uid': TEMPO,
        'type': 'tempo',
        'access': 'proxy',
        'url': 'http://tempo.railway.internal:3200',
        'jsonData': {
            'nodeGraph': {'enabled': True},
            'serviceMap': {'datasourceUid': PROMETHEUS},
            # And back the other way: from a span to the logs of that request
            'tracesToLogsV2': {
                'datasourceUid': LOKI,
                'spanStartTimeShift': '-2m',
                'spanEndTimeShift': '2m',
                'filterByTraceID': True,
                'tags': SERVICE_TAGS,
            },
            'tracesToMetrics': {
                'datasourceUid': PROMETHEUS,
                'spanStartTimeShift': '-2m',
                'spanEndTimeShift': '2m',
                'tags': SERVICE_TAGS,
            },
        },
    },
]

if __name__ == '__main__':
    for datasource in DATASOURCES:
        print(json.dumps(datasource))
