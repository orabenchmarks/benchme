{{- define "benchme.tag" -}}
{{ .Values.image.tag | default .Chart.AppVersion }}
{{- end -}}

{{- define "benchme.image" -}}
{{ .root.Values.image.registry }}/{{ .app }}:{{ include "benchme.tag" .root }}
{{- end -}}

{{- define "benchme.labels" -}}
app.kubernetes.io/part-of: benchme
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "benchme.secretName" -}}
{{ .Values.secrets.existingSecret | default (printf "%s-secrets" .Release.Name) }}
{{- end -}}

{{- define "benchme.databaseUrl" -}}
postgres://benchme:$(POSTGRES_PASSWORD)@{{ .Release.Name }}-postgres:5432/benchme
{{- end -}}

{{- define "benchme.securityContext" -}}
runAsNonRoot: true
runAsUser: 1001
runAsGroup: 1001
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- /* Env shared by every node app. */ -}}
{{- define "benchme.commonEnv" -}}
- name: LOG_LEVEL
  value: {{ .Values.logLevel | quote }}
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "benchme.secretName" . }}
      key: postgresPassword
- name: DATABASE_URL
  value: {{ include "benchme.databaseUrl" . | quote }}
- name: GATEWAY_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "benchme.secretName" . }}
      key: gatewaySecret
- name: MAIL_INTERNAL_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "benchme.secretName" . }}
      key: mailInternalSecret
{{- end -}}
