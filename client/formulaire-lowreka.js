// assets/formulaire-lowreka.js

// Définir la classe de votre Custom Element pour le formulaire multi-étapes
class FormulaireLowreka extends HTMLElement {
    constructor() {
      super(); // Appelle le constructeur de HTMLElement
  
      // Récupérer les éléments du DOM à l'intérieur de cette instance de section
      // 'this' fait référence à l'élément <div class="multi-step-form-wrapper" data-section-type="formulaire-lowreka">
      this.formWrapper = this;
      this.form = this.querySelector('#airtable-multi-step-form');
      this.formSteps = Array.from(this.form.querySelectorAll('.form-step')); // Convertir en tableau
      this.dynamicFormStepsContainer = this.querySelector('#dynamic-form-steps');
      this.formProgressBar = this.querySelector('#form-progress-bar');
      // Ces deux seront initialisés après generateProgressBar()
      this.formProgressBarSteps = null;
      this.progressSegments = null;
  
      this.resetFormLink = this.querySelector('#reset-form-link');
      this.formStatusMain = this.querySelector('#form-status'); // Message général de statut
  
      // Variables d'état
      this.currentStepIndex = 0;
      this.formDataCollected = {};
      this.dynamicQuestionsData = []; // Ce tableau contiendra les questions du backend
  
      // Vérifiez que ces URLs sont correctes et accessibles. Utilisez votre domaine Netlify.
      this.getQuestionsNetlifyUrl = 'https://lowreka.netlify.app/.netlify/functions/get-form-questions';
      this.sendFormDataNetlifyUrl = 'https://lowreka.netlify.app/.netlify/functions/send-to-airtable';
  
      // Liaison des méthodes pour s'assurer que 'this' fait référence à l'instance de la classe
      // C'est crucial car les écouteurs d'événements changent le contexte de 'this'
      this.handleNextClick = this.handleNextClick.bind(this);
      this.handlePrevClick = this.handlePrevClick.bind(this);
      this.handleSubmitForm = this.handleSubmitForm.bind(this);
      this.resetForm = this.resetForm.bind(this);
    }
  
    // Méthode appelée lorsque l'élément est ajouté au DOM
    async connectedCallback() {
      // Initialiser les écouteurs d'événements
      this.updateButtons(); // Attache les écouteurs pour les boutons existants et futurs
      if (this.form) {
        this.form.addEventListener('submit', this.handleSubmitForm);
      }
      if (this.resetFormLink) {
        this.resetFormLink.addEventListener('click', this.resetForm);
      }
  
      // Initialisation asynchrone du formulaire (chargement des questions)
      await this.initializeForm();
      this.showStep(0); // Affiche la toute première étape (l'intro)
    }
  
    // Méthode appelée lorsque l'élément est retiré du DOM (utile dans l'éditeur de thème)
    disconnectedCallback() {
      // Nettoyer les écouteurs d'événements pour éviter les fuites de mémoire
      this.form.querySelectorAll('.next-step').forEach(button => button.removeEventListener('click', this.handleNextClick));
      this.form.querySelectorAll('.prev-step').forEach(button => button.removeEventListener('click', this.handlePrevClick));
      if (this.form) {
        this.form.removeEventListener('submit', this.handleSubmitForm);
      }
      if (this.resetFormLink) {
        this.resetFormLink.removeEventListener('click', this.resetForm);
      }
    }
  
    // --- Vos fonctions existantes transformées en méthodes de classe ---
  
    async initializeForm() {
      try {
        const response = await fetch(this.getQuestionsNetlifyUrl);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const questionsFromServer = await response.json();
        console.log('Données des questions reçues du serveur:', questionsFromServer);
  
        if (Array.isArray(questionsFromServer)) {
          this.dynamicQuestionsData.length = 0; // Vider les données existantes
  
          questionsFromServer.forEach(q => {
            const question = {
              id_question: q.id_question,
              etape: q.etape,
              indicateur_questions: q.indicateur_questions,
              titre: q.titre,
              type_questions: q.type_questions,
              coeff_questions: q.coeff_questions || 0,
              categorie_questions: q.categorie_questions || '',
              options: q.options ? q.options.split(',').map(opt => opt.trim()) : [],
              description: q.description || '',
              obligatoire: q.obligatoire === true,
              ordre: q.ordre || 0
            };
  
            if (question.id_question && question.titre && question.indicateur_questions && question.type_questions && question.etape !== undefined) {
              this.dynamicQuestionsData.push(question);
            } else {
              console.warn("Question ignorée car des champs essentiels sont manquants ou indéfinis:", q);
            }
          });
  
          this.dynamicQuestionsData.sort((a, b) => {
            if (a.etape !== b.etape) {
              return parseInt(a.etape) - parseInt(b.etape);
            }
            return (a.ordre || 0) - (b.ordre || 0);
          });
  
          console.log('Questions traitées pour le formulaire (triées et complétées):', this.dynamicQuestionsData);
  
          this.renderDynamicSteps(); // Rendre les étapes après le chargement et le tri des questions
        } else {
          console.error("Structure de données inattendue du serveur:", questionsFromServer);
          if (this.formStatusMain) {
            this.formStatusMain.textContent = 'Erreur: Structure de données inattendue reçue du serveur.';
            this.formStatusMain.className = 'form-status error';
          }
        }
      } catch (error) {
        console.error('Erreur lors du chargement des questions:', error);
        if (this.formStatusMain) {
          this.formStatusMain.textContent = 'Erreur: Impossible de charger les questions du formulaire. Veuillez réessayer plus tard.';
          this.formStatusMain.className = 'form-status error';
        }
      }
    }
  
    generateInputField(question) {
      let inputHtml = '';
      const name = question.indicateur_questions;
      const id = `question-${question.id_question}`;
      const requiredAttr = question.obligatoire ? 'required' : '';
      const errorHtml = '<div class="form-field-error-message"></div>';
  
      switch (question.type_questions) {
        case 'singleLineText':
        case 'email':
        case 'number':
          const inputType = question.type_questions === 'number' ? 'number' : (question.type_questions === 'email' ? 'email' : 'text');
          inputHtml = `<input type="${inputType}" id="${id}" name="${name}" ${requiredAttr}>`;
          break;
        case 'multilineText':
          inputHtml = `<textarea id="${id}" name="${name}" rows="5" ${requiredAttr}></textarea>`;
          break;
        case 'singleSelect':
        case 'radio':
          inputHtml = `<div class="${question.type_questions}-group">`;
          if (question.options && question.options.length > 0) {
            question.options.forEach(option => {
              const optionId = `${id}-${option.replace(/\s+/g, '-').toLowerCase()}`;
              inputHtml += `
                <input type="radio" id="${optionId}" name="${name}" value="${option}" ${requiredAttr}>
                <label for="${optionId}">${option}</label><br>
              `;
            });
          } else {
            console.warn(`Type '${question.type_questions}' nécessite des options, mais aucune n'est fournie pour la question: ${question.titre}.`);
            inputHtml += `<p style="color:red;">Options manquantes pour cette question.</p>`;
          }
          inputHtml += `</div>`;
          break;
        case 'checkbox':
          inputHtml = `<div class="checkbox-group">`;
          if (question.options && question.options.length > 0) {
            question.options.forEach(option => {
              const optionId = `${id}-${option.replace(/\s+/g, '-').toLowerCase()}`;
              inputHtml += `
                <input type="checkbox" id="${optionId}" name="${name}" value="${option}" ${requiredAttr}>
                <label for="${optionId}">${option}</label><br>
              `;
            });
          } else {
            console.warn(`Type '${question.type_questions}' nécessite des options, mais aucune n'est fournie pour la question: ${question.titre}.`);
            inputHtml += `
                <input type="checkbox" id="${id}" name="${name}" value="Oui" ${requiredAttr}>
                <label for="${id}">Oui</label>
            `;
          }
          inputHtml += `</div>`;
          break;
        case 'date':
          inputHtml = `<input type="date" id="${id}" name="${name}" ${requiredAttr}>`;
          break;
        default:
          console.warn(`Type de question non géré: ${question.type_questions} pour la question: ${question.titre}`);
          inputHtml = `<input type="text" id="${id}" name="${name}" ${requiredAttr} placeholder="Type non géré">`;
      }
  
      return `
        <div class="form-field ${question.type_questions === 'multilineText' ? 'full-width' : ''}">
          <label for="${id}">${question.titre}</label>
          ${question.description ? `<p class="question-description">${question.description}</p>` : ''}
          ${inputHtml}
          ${errorHtml}
        </div>
      `;
    }
  
    renderDynamicSteps() {
      const stepsByStage = {};
      this.dynamicQuestionsData.forEach(q => {
        const etape = q.etape;
        if (!stepsByStage[etape]) {
          stepsByStage[etape] = [];
        }
        stepsByStage[etape].push(q);
      });
  
      const sortedStages = Object.keys(stepsByStage).sort((a, b) => parseInt(a) - parseInt(b));
  
      let currentVisualStepNumber = 2; // Commencer après l'étape d'introduction (1) et l'étape Fournisseur/Produit (2)
  
      this.dynamicFormStepsContainer.innerHTML = ''; // Nettoyer le conteneur des étapes dynamiques
      sortedStages.forEach(stageNum => {
        const stageQuestions = stepsByStage[stageNum].sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
  
        const stepDiv = document.createElement('div');
        stepDiv.classList.add('form-step');
        stepDiv.dataset.step = ++currentVisualStepNumber;
  
        stepDiv.innerHTML = `
          <div class="form-navigation">
            <button type="button" class="arrow-button prev-step">←</button>
            <h3>Étape ${currentVisualStepNumber - 1} : Questions sur l'impact</h3>
          </div>
          <div class="form-grid">
            ${stageQuestions.map(q => this.generateInputField(q)).join('')}
          </div>
          <p id="step${stepDiv.dataset.step}-status" class="form-status"></p>
          <button type="button" class="button next-step">SUIVANT</button>
        `;
        this.dynamicFormStepsContainer.appendChild(stepDiv);
      });
  
      // Mettre à jour la collection formSteps après l'ajout des étapes dynamiques
      this.formSteps = Array.from(this.form.querySelectorAll('.form-step'));
      this.generateProgressBar(); // Régénérer la barre de progression avec toutes les étapes
      this.updateButtons(); // Ré-attacher les écouteurs d'événements aux nouveaux boutons
    }
  
    showStep(stepIndex) {
      this.formSteps.forEach((step, index) => {
        if (index === stepIndex) {
          step.classList.add('active');
        } else {
          step.classList.remove('active');
        }
      });
      this.updateProgressBar(stepIndex);
      this.currentStepIndex = stepIndex;
      this.form.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  
    updateProgressBar(stepIndex) {
      if (!this.formProgressBarSteps || !this.progressSegments) {
        // Si la barre n'a pas encore été générée, ne rien faire
        return;
      }
      this.formProgressBarSteps.forEach((stepEl, index) => {
        if (index <= stepIndex) {
          stepEl.classList.add('active');
        } else {
          stepEl.classList.remove('active');
        }
      });
  
      this.progressSegments.forEach((segmentEl, index) => {
        if (index < stepIndex) {
          segmentEl.classList.add('active');
        } else {
          segmentEl.classList.remove('active');
        }
      });
    }
  
    validateStep(stepIndex) {
      const currentFormStep = this.formSteps[stepIndex];
      if (stepIndex === 0 || currentFormStep.dataset.step === 'final') {
        return true;
      }
  
      const inputs = currentFormStep.querySelectorAll('input[required], textarea[required], select[required]');
      let isValid = true;
  
      currentFormStep.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
      currentFormStep.querySelectorAll('.form-field-error-message').forEach(el => el.textContent = '');
  
      inputs.forEach(input => {
        const fieldContainer = input.closest('.form-field');
        const errorMessageEl = fieldContainer ? fieldContainer.querySelector('.form-field-error-message') : null;
  
        let fieldValid = true;
        let fieldErrorMessage = '';
  
        if (input.type !== 'radio' && input.type !== 'checkbox') {
          if (!input.value.trim()) {
            fieldValid = false;
            fieldErrorMessage = 'Ce champ est requis.';
          } else if (input.type === 'email' && !/^[^@]+@[^@]+\.[^@]+$/.test(input.value)) {
            fieldValid = false;
            fieldErrorMessage = 'Veuillez entrer une adresse email valide.';
          } else if (input.name === 'siret_fournisseur' && input.value.trim() && !/^[0-9]{14}$/.test(input.value)) {
            fieldValid = false;
            fieldErrorMessage = 'Le numéro SIRET doit contenir 14 chiffres.';
          }
        }
  
        if ((input.type === 'radio' || input.type === 'checkbox') && input.required) {
          const groupName = input.name;
          const groupInputs = currentFormStep.querySelectorAll(`input[name="${groupName}"]`);
          const isGroupChecked = Array.from(groupInputs).some(item => item.checked);
  
          if (!isGroupChecked) {
            fieldValid = false;
            fieldErrorMessage = 'Veuillez sélectionner au moins une option.';
            groupInputs.forEach(el => el.classList.add('is-invalid'));
          } else {
            groupInputs.forEach(el => el.classList.remove('is-invalid'));
          }
        }
  
        if (!fieldValid) {
          isValid = false;
          if (errorMessageEl) {
            errorMessageEl.textContent = fieldErrorMessage;
          }
          if (input.type !== 'radio' && input.type !== 'checkbox') {
            input.classList.add('is-invalid');
          }
        } else {
          if (input.type !== 'radio' && input.type !== 'checkbox') {
            input.classList.remove('is-invalid');
          }
        }
      });
  
      const stepStatusElement = currentFormStep.querySelector('.form-status');
      if (stepStatusElement) {
        if (!isValid) {
          stepStatusElement.textContent = 'Veuillez corriger les erreurs dans les champs requis.';
          stepStatusElement.className = 'form-status error';
        } else {
          stepStatusElement.textContent = '';
          stepStatusElement.className = '';
        }
      }
      return isValid;
    }
  
    collectDataForStep(stepIndex) {
      const currentFormStep = this.formSteps[stepIndex];
      const inputs = currentFormStep.querySelectorAll('input, textarea, select');
  
      const checkboxGroupNamesInStep = new Set();
      inputs.forEach(input => {
        if (input.type === 'checkbox' && input.name) {
          checkboxGroupNamesInStep.add(input.name);
        }
      });
      checkboxGroupNamesInStep.forEach(name => {
        this.formDataCollected[name] = [];
      });
  
      inputs.forEach(input => {
        if (!input.name || input.type === 'submit' || input.type === 'button') {
          return;
        }
  
        if (input.type === 'radio') {
          if (input.checked) {
            this.formDataCollected[input.name] = input.value.trim();
          }
        } else if (input.type === 'checkbox') {
          if (input.checked) {
            if (!this.formDataCollected[input.name]) {
              this.formDataCollected[input.name] = [];
            }
            this.formDataCollected[input.name].push(input.value.trim());
          }
        } else {
          this.formDataCollected[input.name] = input.value.trim();
        }
      });
      console.log('formDataCollected après collecte de l\'étape:', this.formDataCollected);
    }
  
    generateSummary() {
      const formSummary = this.querySelector('#form-summary');
      if (!formSummary) {
        console.error("L'élément 'form-summary' n'est pas trouvé. Le résumé ne peut pas être généré.");
        return;
      }
      let summaryHTML = '';
  
      summaryHTML += `<h4>Informations Fournisseur</h4>`;
      if (this.formDataCollected.prenom_fournisseur) summaryHTML += `<p><strong>Prénom:</strong> ${this.formDataCollected.prenom_fournisseur}</p>`;
      if (this.formDataCollected.nom_fournisseur) summaryHTML += `<p><strong>Nom:</strong> ${this.formDataCollected.nom_fournisseur}</p>`;
      if (this.formDataCollected.email_fournisseur) summaryHTML += `<p><strong>Email:</strong> ${this.formDataCollected.email_fournisseur}</p>`;
      if (this.formDataCollected.entreprise_fournisseur) summaryHTML += `<p><strong>Entreprise:</strong> ${this.formDataCollected.entreprise_fournisseur}</p>`;
      if (this.formDataCollected.siret_fournisseur) summaryHTML += `<p><strong>SIRET:</strong> ${this.formDataCollected.siret_fournisseur}</p>`;
  
      summaryHTML += `<h4 style="margin-top: 20px;">Informations Produit</h4>`;
      if (this.formDataCollected.nom_produit) summaryHTML += `<p><strong>Nom du produit:</strong> ${this.formDataCollected.nom_produit}</p>`;
      if (this.formDataCollected.description_produit) summaryHTML += `<p><strong>Description du produit:</strong> ${this.formDataCollected.description_produit}</p>`;
  
      summaryHTML += `<h4 style="margin-top: 20px;">Questions Dynamiques</h4>`;
      this.dynamicQuestionsData.forEach(question => {
        const answerKey = question.indicateur_questions;
        let answerValue = this.formDataCollected[answerKey];
  
        if (answerValue === undefined || answerValue === null || answerValue === '') {
          answerValue = "Non renseigné";
        } else if (Array.isArray(answerValue)) {
          answerValue = answerValue.join(', ');
        }
  
        summaryHTML += `<p><strong>${question.titre}:</strong> ${answerValue}</p>`;
      });
  
      formSummary.innerHTML = summaryHTML;
    }
  
    generateProgressBar() {
      if (!this.formProgressBar) {
        console.error("L'élément 'form-progress-bar' n'est pas trouvé. La barre de progression ne peut pas être générée.");
        return;
      }
      this.formProgressBar.innerHTML = '';
      const totalVisualSteps = this.formSteps.length;
  
      for (let i = 0; i < totalVisualSteps; i++) {
        const stepWrapper = document.createElement('div');
        stepWrapper.classList.add('step-wrapper');
  
        const stepDiv = document.createElement('div');
        stepDiv.classList.add('step');
        stepDiv.dataset.step = i + 1;
        stepDiv.textContent = i + 1;
        stepWrapper.appendChild(stepDiv);
  
        if (i < totalVisualSteps - 1) {
          const segmentDiv = document.createElement('div');
          segmentDiv.classList.add('progress-segment');
          segmentDiv.dataset.segment = i + 1;
          stepWrapper.appendChild(segmentDiv);
        }
        this.formProgressBar.appendChild(stepWrapper);
      }
      this.formProgressBarSteps = this.formProgressBar.querySelectorAll('.step');
      this.progressSegments = this.formProgressBar.querySelectorAll('.progress-segment');
    }
  
    updateButtons() {
      // Supprimer tous les écouteurs existants pour éviter les duplications
      this.querySelectorAll('.next-step').forEach(button => button.removeEventListener('click', this.handleNextClick));
      this.querySelectorAll('.prev-step').forEach(button => button.removeEventListener('click', this.handlePrevClick));
  
      // Ré-attacher les écouteurs d'événements
      this.querySelectorAll('.next-step').forEach(button => {
        button.addEventListener('click', this.handleNextClick);
      });
      this.querySelectorAll('.prev-step').forEach(button => {
        button.addEventListener('click', this.handlePrevClick);
      });
    }
  
    handleNextClick() {
      if (this.validateStep(this.currentStepIndex)) {
        this.collectDataForStep(this.currentStepIndex);
  
        if (this.currentStepIndex + 1 < this.formSteps.length) {
          this.showStep(this.currentStepIndex + 1);
          if (this.formSteps[this.currentStepIndex].dataset.step === 'final') {
            this.generateSummary();
          }
        }
      }
    }
  
    handlePrevClick() {
      if (this.currentStepIndex > 0) {
        this.showStep(this.currentStepIndex - 1);
      }
    }
  
    resetForm(event) {
      if (event) event.preventDefault();
      this.form.reset();
  
      for (const key in this.formDataCollected) {
        delete this.formDataCollected[key];
      }
      if (this.formStatusMain) {
        this.formStatusMain.textContent = '';
        this.formStatusMain.className = '';
      }
      this.formSteps.forEach(step => {
        const statusElement = step.querySelector('.form-status');
        if (statusElement) {
          statusElement.textContent = '';
          statusElement.className = '';
        }
        step.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
        step.querySelectorAll('.form-field-error-message').forEach(el => el.textContent = '');
      });
      // Réinitialiser les questions dynamiques et les étapes pour les recharger
      this.dynamicQuestionsData.length = 0;
      this.dynamicFormStepsContainer.innerHTML = '';
      this.initializeForm(); // Re-fetch les questions et re-render les étapes
      this.showStep(0); // Retourne à la première étape
    }
  
    async handleSubmitForm(event) {
      event.preventDefault();
  
      if (this.formStatusMain) {
        this.formStatusMain.textContent = 'Envoi en cours...';
        this.formStatusMain.className = 'form-status';
      }
  
      console.log('DEBUG CLIENT: Final formDataCollected being sent:', this.formDataCollected);
      console.log('DEBUG CLIENT: Final dynamicQuestionsData being sent:', this.dynamicQuestionsData);
  
      try {
        const response = await fetch(this.sendFormDataNetlifyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            formData: this.formDataCollected,
            dynamicQuestions: this.dynamicQuestionsData
          }),
        });
  
        const result = await response.json();
  
        if (response.ok) {
          if (this.formStatusMain) {
            this.formStatusMain.textContent = 'Formulaire soumis avec succès !';
            this.formStatusMain.className = 'form-status success';
          }
          this.form.reset();
          for (const key in this.formDataCollected) {
            delete this.formDataCollected[key];
          }
          // Optionnel: revenir à la première étape ou afficher un message de remerciement final plus élaboré
          // setTimeout(() => this.showStep(0), 3000);
        } else {
          if (this.formStatusMain) {
            this.formStatusMain.textContent = `Erreur lors de la soumission: ${result.message || 'Une erreur inconnue est survenue.'}`;
            this.formStatusMain.className = 'form-status error';
          }
        }
      } catch (error) {
        console.error('Erreur réseau ou inattendue lors de la soumission:', error);
        if (this.formStatusMain) {
          this.formStatusMain.textContent = `Erreur: Impossible de communiquer avec le serveur. ${error.message}`;
          this.formStatusMain.className = 'form-status error';
        }
      }
    }
  }
  
  // Enregistrer votre Custom Element. Le nom de la balise doit contenir un tiret.
  // Il doit correspondre à l'attribut data-section-type="formulaire-lowreka" sur votre div racine dans le Liquid.
  customElements.define('formulaire-lowreka', FormulaireLowreka);