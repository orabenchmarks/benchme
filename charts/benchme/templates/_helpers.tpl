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
- name: ASK_RANKER
  value: {{ .Values.ranker.askRanker | quote }}
- name: LLM_BASE_URL
  value: {{ .Values.ranker.llmBaseUrl | quote }}
- name: LLM_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "benchme.secretName" . }}
      key: llmApiKey
      # Optional: absent from an existingSecret predating the llm/jev rankers,
      # or simply unused by the default lexical ranker.
      optional: true
- name: LLM_MODEL
  value: {{ .Values.ranker.llmModel | quote }}
- name: LLM_INPUT_USD_PER_MTOK
  value: {{ .Values.ranker.llmInputUsdPerMtok | quote }}
- name: LLM_OUTPUT_USD_PER_MTOK
  value: {{ .Values.ranker.llmOutputUsdPerMtok | quote }}
- name: JEV_BASE_URL
  value: {{ .Values.ranker.jevBaseUrl | quote }}
- name: JEV_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "benchme.secretName" . }}
      key: jevApiKey
      optional: true
- name: JEV_MODEL
  value: {{ .Values.ranker.jevModel | quote }}
- name: RANKER_CONCURRENCY
  value: {{ .Values.ranker.concurrency | quote }}
- name: ASK_RANKER_OVERRIDE
  value: {{ .Values.ranker.override | ternary "1" "0" | quote }}
{{- end -}}

{{- define "benchme.pullSecrets" -}}
{{- with .Values.image.pullSecrets }}
imagePullSecrets:
{{- range . }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end -}}

{{- /* nodeSelector + tolerations for every benchme pod (indent by the caller). */ -}}
{{- define "benchme.scheduling" -}}
{{- with .Values.scheduling.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.scheduling.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}
